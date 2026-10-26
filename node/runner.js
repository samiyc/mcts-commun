import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nextJob } from "../src/schedule.js";
import { alive, heatSettings, memoryFloorGb, readCpuTemperature, readSlots, takeSlot, waitUntilCool, watchHeat, watchMemory } from "./machine.js";
import { stamp } from "./queue.js";
import { runJob, skipCheck } from "./run-job.js";

/**
 * The runner of `mcts-backlog` (bin/backlog.js): the queue played to its end, jobs side by side as long as their
 * threads fit in the machine's budget, the next by lopin's order (src/schedule.js). Each job's output goes to runs/,
 * its trace to traces/, a finished job to the archive, a line to job-log/; what the runner does to its journal.
 *
 * The guards, as in lopin: under `MCTS_RAM_FLOOR` GB free (5) twice in a row, the most recent job stops and ends
 * failed; at `MCTS_HEAT_ALERT` °C (90, LibreHardwareMonitor's web server) twice in a row, every job stops, goes back to
 * the queue, and the queue goes on once the CPU is under `MCTS_HEAT_RESUME` °C (75); a job stopped three times by the
 * heat ends failed. A job marked `cancel` (`mcts-backlog --cancel`) is stopped and ends cancelled; one whose `skipIf`
 * says so is skipped before it starts.
 */
const HEAT_STOPS = 3;
const CANCELLED = "annulé (mcts-backlog --cancel)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runQueue({ home, budget, queue, journal, pollMs = 5_000 }) {
  const runner = { home, budget, queue, journal, pollMs, heat: heatSettings(), ramFloor: memoryFloorGb(), heatStops: new Map(), running: new Map(), cooling: null, waitingForSlot: new Set() };
  // A runner that dies says why in its journal first.
  process.on("uncaughtExceptionMonitor", (error, origin) => journal("crash", { origin, message: error?.message ?? String(error), stack: error?.stack, running: [...runner.running.keys()] }));
  await mkdir(queue.files.runs, { recursive: true });
  await queue.archiveFinished();
  await requeueOrphans(runner);
  await announce(runner);
  const temperature = guardHeat(runner);
  await loop(runner);
  temperature.stop();
  journal("runner-ended", {});
  console.log("File vide.");
}

/** A job left running by a runner that died goes back to the queue. */
async function requeueOrphans({ queue, journal }) {
  const ids = await queue.change((current) => {
    const orphans = current.jobs.filter((job) => job.status === "running" && !alive(job.runnerPid));
    for (const job of orphans) Object.assign(job, { status: "todo" });
    return orphans.length ? orphans.map((job) => job.id) : { keep: true };
  });
  if (Array.isArray(ids)) journal("orphans-requeued", { ids });
}

async function announce({ queue, budget, heat, ramFloor, journal }) {
  const reading = await readCpuTemperature(heat);
  const guard = heat.alert > 0 ? `garde thermique à ${heat.alert} °C, reprise sous ${heat.resume} °C` : "garde thermique coupée";
  console.log(`File de la machine : ${queue.files.queue}, ${budget} fils au plus.`);
  console.log(reading ? `CPU à ${reading.celsius} °C (${reading.sensor}) ; ${guard}.` : "Température du CPU illisible (LibreHardwareMonitor) : pas de garde thermique.");
  journal("runner-started", { budget, queue: queue.files.queue, cpu: reading, heat: heat.alert > 0 ? { alert: heat.alert, resume: heat.resume } : null, ramFloorGb: ramFloor });
  console.log(ramFloor > 0 ? `Garde mémoire : un job s'arrête sous ${ramFloor} Go libres.` : "Garde mémoire coupée.");
}

/** One heat guard for the machine: at the alert, every job stops and goes back to the queue. */
function guardHeat(runner) {
  const { heat, journal, running } = runner;
  const cooled = (reading) => {
    runner.cooling = null;
    journal("heat-resumed", { celsius: reading?.celsius ?? null });
    console.log("  CPU refroidi : la file repart");
  };
  return watchHeat({
    settings: heat,
    onAlert: (celsius) => {
      journal("heat-alert", { celsius, stopping: [...running.keys()] });
      runner.cooling = waitUntilCool({ settings: heat }).then(cooled);
      for (const one of running.values()) one.guard.abort(`garde thermique, CPU à ${celsius} °C`);
    },
  });
}

async function loop(runner) {
  for (;;) {
    if (runner.cooling) await runner.cooling;
    const current = await runner.queue.read();
    stopCancelled(runner, current.jobs);
    const job = await pickNext(runner, current);
    if (job && (await tryStart(runner, job))) continue;
    if (!job && runner.running.size === 0) return;
    // Wait for a job to end, or for another runner to free threads.
    await Promise.race([...[...runner.running.values()].map((one) => one.done), sleep(runner.pollMs)]);
  }
}

/** Stops the running jobs a `--cancel` marked. */
function stopCancelled({ running, journal }, jobs) {
  for (const job of jobs.filter((one) => one.cancel && running.has(one.id))) {
    const one = running.get(job.id);
    if (one.stops.cancel) continue;
    one.stops.cancel = CANCELLED;
    journal("job-cancelled", { id: job.id });
    one.guard.abort(CANCELLED);
  }
}

/** The next job by lopin's order, among those not running; a job for another machine (`machine`, node/remote.js) is left. */
async function pickNext({ queue, running }, current) {
  const archive = await queue.readArchive();
  const waiting = current.jobs.filter((job) => job.status !== "running" && !running.has(job.id) && !job.machine);
  return nextJob(waiting, [...archive, ...current.jobs.filter((one) => one.status === "running")], Date.now());
}

/** Starts `job` if its threads are free, or skips it on its `skipIf`: true if it did either. */
async function tryStart(runner, job) {
  const { home, budget, journal } = runner;
  const threads = Math.max(1, Math.min(job.threads ?? 1, budget));
  const slot = await takeSlot({ home, id: job.id, threads, budget });
  if (!slot) {
    if (!runner.waitingForSlot.has(job.id)) journal("slot-waiting", { id: job.id, threads, slots: (await readSlots(home)).map(({ runner: who, id, threads: taken }) => ({ runner: who, id, threads: taken })) });
    runner.waitingForSlot.add(job.id);
    return false;
  }
  // Taken under the queue's lock: another runner that read the same queue does not start it too.
  const taken = await claim(runner.queue, job);
  if (!taken || (job.skipIf && (await skipped(runner, job)))) {
    await slot.release();
    return true;
  }
  await start(runner, { job, slot, threads });
  return true;
}

/** Marks `job` running for this runner if it still waits: false when another runner has taken it. */
async function claim(queue, job) {
  const result = await queue.change((current) => {
    const fresh = current.jobs.find((one) => one.id === job.id);
    if (!fresh || !["todo", "scheduled"].includes(fresh.status)) return { keep: true, claimed: false };
    Object.assign(fresh, { status: "running", startedAt: stamp(), runnerPid: process.pid });
    return { claimed: true };
  });
  return result.claimed;
}

/** Skips `job` when its `skipIf` says so: true if it did. */
async function skipped({ home, queue, journal }, job) {
  const { skip, reason, code } = await skipCheck(job, home);
  if (!skip) return false;
  await queue.update(job.id, { status: "skipped", doneAt: stamp(), minutes: 0, reason });
  await queue.archiveFinished();
  journal("job-skipped", { id: job.id, reason, code });
  console.log(`↷ ${job.id} : sauté — ${reason}`);
  return true;
}

async function start(runner, run) {
  const { home, queue, journal, ramFloor } = runner;
  const { job, threads } = run;
  const name = `${stamp().replace(/[:T]/g, "-")}_${job.id}`;
  const files = { out: path.join(queue.files.runs, `${name}.txt`), trace: path.join(queue.files.traces, `${name}.jsonl`) };
  const guard = new AbortController();
  const stops = { memory: null, cancel: null };
  const onLow = (gb) => {
    stops.memory = `arrêté par la garde mémoire : ${gb} Go libres, sous ${ramFloor} Go`;
    journal("memory-stop", { id: job.id, freeGb: gb, floorGb: ramFloor });
    guard.abort(stops.memory);
  };
  Object.assign(run, { files, stops, memory: watchMemory({ floorGb: ramFloor, onLow }), started: Date.now() });
  console.log(`▶ ${job.id} (${job.estimate ?? "?"}, ${threads} fil${threads > 1 ? "s" : ""}) : ${job.cwd} : ${job.command}`);
  const child = runJob(job, files, { signal: guard.signal, threads, home });
  const output = path.relative(home, files.out);
  await queue.update(job.id, { childPid: child.pid, output, trace: path.relative(home, files.trace) });
  journal("job-started", { id: job.id, cwd: job.cwd, command: job.command, threads, childPid: child.pid, output });
  const done = child.done.then((code) => ended(runner, run, code));
  runner.running.set(job.id, { guard, stops, done });
  done.finally(() => runner.running.delete(job.id));
}

/** How a job ended, from its process's end and what stopped it. */
function endOf(code, stops) {
  if (code === "timeout") return { status: "timeout" };
  if (code === 0) return { status: "done" };
  if (code !== "aborted") return { status: "failed" };
  if (stops.cancel) return { status: "cancelled", reason: stops.cancel };
  return { status: "failed", reason: stops.memory ?? `arrêté ${HEAT_STOPS} fois par la garde thermique` };
}

/** Back to the queue after the heat guard stopped `job`, unless stopped too often: true if it went back. */
async function heatRequeued({ heatStops, queue, journal }, job) {
  const count = (heatStops.get(job.id) ?? 0) + 1;
  heatStops.set(job.id, count);
  if (count >= HEAT_STOPS) return false;
  await queue.update(job.id, { status: "todo" });
  journal("job-requeued", { id: job.id, heatStops: count });
  console.log(`■ ${job.id} : arrêté par la garde thermique (${count}/${HEAT_STOPS}), remis dans la file`);
  return true;
}

async function ended(runner, run, code) {
  const { home, queue, journal } = runner;
  const { job, stops } = run;
  await run.slot.release();
  const free = run.memory.stop();
  const minutes = Math.round((Date.now() - run.started) / 600) / 100;
  const byHeat = code === "aborted" && !stops.memory && !stops.cancel;
  if (byHeat && (await heatRequeued(runner, job))) return;
  const { status, reason } = endOf(code, stops);
  const why = reason ? { reason } : {};
  await queue.update(job.id, { status, doneAt: stamp(), minutes: Math.round(minutes), output: path.relative(home, run.files.out), ...why });
  await queue.archiveFinished();
  journal("job-ended", { id: job.id, status, code, minutes: Math.round(minutes * 100) / 100, ...why });
  const line = { id: job.id, cwd: job.cwd, command: job.command, threads: run.threads, cores: os.cpus().length, startedAt: new Date(run.started).toISOString(), minutes, status, source: "mcts-backlog", ...free };
  await mkdir(queue.files.log, { recursive: true });
  await appendFile(path.join(queue.files.log, `${stamp().slice(0, 7)}.jsonl`), `${JSON.stringify(line)}\n`);
  console.log(`■ ${job.id} : ${status}, ${Math.round(minutes)} min → ${run.files.out}`);
}

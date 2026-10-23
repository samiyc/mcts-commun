#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { alive, backlogHome, heatSettings, memoryFloorGb, readCpuTemperature, takeSlot, threadBudget, waitUntilCool, watchHeat, watchMemory } from "../node/machine.js";
import { isFinished, nextJob, planNight } from "../src/schedule.js";

/**
 * `mcts-backlog`: the machine's long jobs, every project's (Sami, 23/10/2026: the scheduler in common, so that the
 * hospital, the warehouse and the kitchen run their night measures too). One queue for the machine,
 * `~/.mcts-backlog/queue.json` (`MCTS_BACKLOG_HOME` or `--home` elsewhere); each job says the folder it runs in.
 *
 *   mcts-backlog                 run the queue to its end
 *   mcts-backlog --list          the jobs to come in the planned order, and the last ones done
 *   mcts-backlog --add ID --cwd DIR [--estimate "40 min"] [--threads N] [--priority 1|2|3] [--after A,B]
 *                [--due 2026-10-24T08:00] [--limit MIN] -- COMMAND…
 *   mcts-backlog --add-file PROJECT/night.json [--tag 2026-10-24]
 *                every job of a project's file (`{ jobs: [{ id, command, estimate, … }] }`), run in the file's folder;
 *                each id (and its `after`) gets the tag, today's date by default, so the file can be queued again
 *                the next night.
 *
 * The order is lopin's (src/schedule.js): prerequisites, a `due` it would miss, then Smith's rule. Jobs run side by
 * side as long as their threads (`threads`, 1 by default: the projects' measures are single-threaded) fit in the
 * machine's budget (node/machine.js: every core but 3, 18 at most; `--budget N`). The budget is the machine's, not
 * this runner's: the slots (node/machine.js) count lopin's jobs too, so two runners never ask more than it lends.
 * Each job's output goes to runs/, a finished job to done/YYYY-MM.json, a line to job-log/YYYY-MM.jsonl. A job
 * runs `limit` minutes at most (120). The guards, as in lopin: under `MCTS_RAM_FLOOR` GB free (5) twice in a row,
 * the most recent job stops and ends failed; at `MCTS_HEAT_ALERT` °C (90, LibreHardwareMonitor's web server)
 * twice in a row, every job stops, goes back to the queue, and the queue goes on once the CPU is under
 * `MCTS_HEAT_RESUME` °C (75); a job stopped three times by the heat ends failed.
 */
const LIMIT = 120;
const HEAT_STOPS = 3;
const POLL_MS = Number(process.env.MCTS_BACKLOG_POLL_MS || 5_000);
const args = process.argv.slice(2);
const option = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const home = path.resolve(option("--home", backlogHome()));
const budget = Number(option("--budget", threadBudget()));
const files = {
  queue: path.join(home, "queue.json"),
  done: path.join(home, "done"),
  runs: path.join(home, "runs"),
  log: path.join(home, "job-log"),
};
const stamp = (date = new Date()) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

async function readQueue() {
  try {
    return JSON.parse(await readFile(files.queue, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { jobs: [] };
    throw error;
  }
}
async function saveQueue(queue) {
  await mkdir(home, { recursive: true });
  await writeFile(`${files.queue}.tmp`, `${JSON.stringify(queue, null, 2)}\n`);
  await rename(`${files.queue}.tmp`, files.queue);
}
async function readArchive() {
  const names = (await readdir(files.done).catch(() => [])).filter((name) => name.endsWith(".json")).sort();
  const months = await Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(files.done, name), "utf8"))));
  return months.flat();
}
/** Moves the finished jobs of the queue to their month's archive. */
async function archiveFinished() {
  const queue = await readQueue();
  const finished = queue.jobs.filter(isFinished);
  if (finished.length === 0) return 0;
  await mkdir(files.done, { recursive: true });
  for (const job of finished) {
    const file = path.join(files.done, `${job.doneAt.slice(0, 7)}.json`);
    const month = JSON.parse(await readFile(file, "utf8").catch(() => "[]"));
    await writeFile(file, `${JSON.stringify([...month, job], null, 2)}\n`);
  }
  await saveQueue({ ...queue, jobs: queue.jobs.filter((job) => !isFinished(job)) });
  return finished.length;
}
async function updateJob(id, change) {
  const queue = await readQueue();
  const job = queue.jobs.find((one) => one.id === id);
  if (job) Object.assign(job, change);
  await saveQueue(queue);
}

const tags = (job) => [job.threads > 1 ? `${job.threads} fils` : "", job.priority && job.priority !== 2 ? `priorité ${job.priority}` : "", job.due ? `pour ${job.due}` : "", job.after?.length ? `après ${job.after.join(", ")}` : ""].filter(Boolean).join(", ");
const lineOf = (job) => `[${job.status}] ${job.id} — ${job.estimate ?? "?"} — ${job.cwd} : ${job.command}${tags(job) ? ` (${tags(job)})` : ""}${job.doneAt ? ` (fait le ${job.doneAt}, ${job.minutes} min)` : ""}${job.reason ? ` (${job.reason})` : ""}`;

if (args.includes("--add")) {
  const id = option("--add");
  const at = args.indexOf("--");
  if (!id || at < 0 || !option("--cwd")) {
    console.error('usage : mcts-backlog --add ID --cwd DOSSIER [--estimate "40 min"] [--threads N] [--priority 2] [--after A,B] [--due ISO] [--limit MIN] -- COMMANDE…');
    process.exit(1);
  }
  const queue = await readQueue();
  if ([...queue.jobs, ...(await readArchive())].some((job) => job.id === id)) throw new Error(`le job ${id} existe déjà`);
  const job = { id, cwd: path.resolve(option("--cwd")), command: args.slice(at + 1).join(" "), estimate: option("--estimate", "1 h"), status: "todo" };
  for (const [flag, key, read] of [["--threads", "threads", Number], ["--priority", "priority", Number], ["--limit", "limit", Number], ["--due", "due", String], ["--after", "after", (text) => text.split(",")]]) if (option(flag) !== null) job[key] = read(option(flag));
  await saveQueue({ ...queue, jobs: [...queue.jobs, job] });
  console.log(`Ajouté : ${lineOf(job)}`);
  process.exit(0);
}

if (args.includes("--add-file")) {
  const file = path.resolve(option("--add-file"));
  const tag = option("--tag", stamp().slice(0, 10));
  const { jobs } = JSON.parse(await readFile(file, "utf8"));
  const queue = await readQueue();
  const taken = new Set([...queue.jobs, ...(await readArchive())].map((job) => job.id));
  const tagged = (id) => `${id}-${tag}`;
  const added = jobs.map((job) => ({ status: "todo", estimate: "1 h", ...job, id: tagged(job.id), cwd: path.dirname(file), ...(job.after ? { after: job.after.map(tagged) } : {}) }));
  const twice = added.find((job) => taken.has(job.id));
  if (twice) throw new Error(`le job ${twice.id} existe déjà : --tag pour une autre série`);
  await saveQueue({ ...queue, jobs: [...queue.jobs, ...added] });
  for (const job of added) console.log(`Ajouté : ${lineOf(job)}`);
  process.exit(0);
}

if (args.includes("--list")) {
  const archive = await readArchive();
  for (const job of archive.slice(-3)) console.log(lineOf(job));
  const { order, waiting } = planNight((await readQueue()).jobs, archive, Date.now());
  if (order.length) console.log(`Ordre prévu (l'un après l'autre ; côte à côte tant que leurs fils tiennent dans ${budget}) :`);
  for (const { job, start } of order) console.log(`${new Date(start).toTimeString().slice(0, 5)}  ${lineOf(job)}`);
  for (const { job, reason } of waiting) console.log(`attend : ${reason}  ${lineOf(job)}`);
  process.exit(0);
}

/** Runs `job` in its folder, its output in `outFile`; resolves with its exit code, "timeout" or "aborted". */
function runJob(job, outFile, { signal, threads }) {
  const out = createWriteStream(outFile);
  return new Promise((resolve) => {
    const child = spawn(job.command, { cwd: job.cwd, shell: true, env: { ...process.env, MCTS_THREADS: String(threads), LOPIN_THREADS: String(threads) } });
    let ended = null;
    const stop = (why, note) => {
      if (ended) return;
      ended = why;
      out.write(`\n[mcts-backlog] ${note}\n`);
      if (process.platform === "win32") spawn(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/pid", String(child.pid), "/T", "/F"]);
      else child.kill("SIGTERM");
    };
    const minutes = job.limit ?? LIMIT;
    const timer = setTimeout(() => stop("timeout", `arrêté au bout de ${minutes} min`), minutes * 60_000);
    signal.addEventListener("abort", () => stop("aborted", `arrêté : ${signal.reason}`), { once: true });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => out.write(chunk));
    child.on("error", (error) => out.write(`\n[mcts-backlog] ${error.message}\n`));
    child.on("close", (code) => {
      clearTimeout(timer);
      out.end(() => resolve(ended ?? code));
    });
  });
}

const heat = heatSettings();
const ramFloor = memoryFloorGb();
const heatStops = new Map();
const running = new Map();
let cooling = null;
await mkdir(files.runs, { recursive: true });
await archiveFinished();
// A job left running by a runner that died goes back to the queue.
{
  const queue = await readQueue();
  const orphans = queue.jobs.filter((job) => job.status === "running" && !alive(job.runnerPid));
  for (const job of orphans) Object.assign(job, { status: "todo" });
  if (orphans.length) await saveQueue(queue);
}
const reading = await readCpuTemperature(heat);
console.log(`File de la machine : ${files.queue}, ${budget} fils au plus.`);
if (!reading) console.log("Température du CPU illisible (LibreHardwareMonitor) : pas de garde thermique.");
else console.log(`CPU à ${reading.celsius} °C (${reading.sensor}) ; ${heat.alert > 0 ? `garde thermique à ${heat.alert} °C, reprise sous ${heat.resume} °C` : "garde thermique coupée"}.`);
console.log(ramFloor > 0 ? `Garde mémoire : un job s'arrête sous ${ramFloor} Go libres.` : "Garde mémoire coupée.");

// One heat guard for the machine: at the alert, every job stops and goes back to the queue.
const temperature = watchHeat({
  settings: heat,
  onAlert: (celsius) => {
    cooling = waitUntilCool({ settings: heat }).then(() => {
      cooling = null;
      console.log("  CPU refroidi : la file repart");
    });
    for (const one of running.values()) one.guard.abort(`garde thermique, CPU à ${celsius} °C`);
  },
});

async function start(job, slot, threads) {
  const outFile = path.join(files.runs, `${stamp().replace(/[:T]/g, "-")}_${job.id}.txt`);
  const guard = new AbortController();
  let memoryStop = null;
  const memory = watchMemory({
    floorGb: ramFloor,
    onLow: (gb) => {
      memoryStop = `arrêté par la garde mémoire : ${gb} Go libres, sous ${ramFloor} Go`;
      guard.abort(memoryStop);
    },
  });
  const started = Date.now();
  console.log(`▶ ${job.id} (${job.estimate ?? "?"}, ${threads} fil${threads > 1 ? "s" : ""}) : ${job.cwd} : ${job.command}`);
  await updateJob(job.id, { status: "running", startedAt: stamp(), runnerPid: process.pid });
  const done = runJob(job, outFile, { signal: guard.signal, threads }).then(async (code) => {
    await slot.release();
    const free = memory.stop();
    const minutes = Math.round((Date.now() - started) / 600) / 100;
    if (code === "aborted" && !memoryStop) {
      const count = (heatStops.get(job.id) ?? 0) + 1;
      heatStops.set(job.id, count);
      if (count < HEAT_STOPS) {
        await updateJob(job.id, { status: "todo" });
        console.log(`■ ${job.id} : arrêté par la garde thermique (${count}/${HEAT_STOPS}), remis dans la file`);
        return;
      }
    }
    const status = code === "timeout" ? "timeout" : code === 0 ? "done" : "failed";
    const reason = code === "aborted" ? (memoryStop ?? `arrêté ${HEAT_STOPS} fois par la garde thermique`) : undefined;
    await updateJob(job.id, { status, doneAt: stamp(), minutes: Math.round(minutes), output: path.relative(home, outFile), ...(reason ? { reason } : {}) });
    await archiveFinished();
    await mkdir(files.log, { recursive: true });
    await appendFile(path.join(files.log, `${stamp().slice(0, 7)}.jsonl`), `${JSON.stringify({ id: job.id, cwd: job.cwd, command: job.command, threads, cores: os.cpus().length, startedAt: new Date(started).toISOString(), minutes, status, source: "mcts-backlog", ...free })}\n`);
    console.log(`■ ${job.id} : ${status}, ${Math.round(minutes)} min → ${outFile}`);
  });
  running.set(job.id, { guard, done });
  done.finally(() => running.delete(job.id));
}

for (;;) {
  if (cooling) await cooling;
  const queue = await readQueue();
  const archive = await readArchive();
  const waiting = queue.jobs.filter((job) => job.status !== "running" && !running.has(job.id));
  // The next job by lopin's order, among those not running; jobs that would not fit wait for a slot.
  const job = nextJob(waiting, [...archive, ...queue.jobs.filter((one) => one.status === "running")], Date.now());
  if (job) {
    const threads = Math.max(1, Math.min(job.threads ?? 1, budget));
    const slot = await takeSlot({ home, id: job.id, threads, budget });
    if (slot) {
      await start(job, slot, threads);
      continue;
    }
  }
  if (!job && running.size === 0) break;
  // Wait for a job to end, or for another runner to free threads.
  await Promise.race([...[...running.values()].map((one) => one.done), new Promise((resolve) => setTimeout(resolve, POLL_MS))]);
}
temperature.stop();
console.log("File vide.");

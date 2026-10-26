import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { holdOf, indexJobs, isFinished, minutesOf, nextJob } from "../src/schedule.js";
import { readJournal } from "./journal.js";
import { alive, heatSettings, readCpuTemperature, readSlots, threadBudget } from "./machine.js";
import { tailOf } from "./tail.js";

/**
 * What the backlog's page, its terminal view and `--list` show (Sami, 26/10/2026: the backlog was a black box).
 * `readBacklog(home)` reads the machine's queue and what surrounds it, never writing: the runner may be at work. A
 * file caught half written keeps its last good reading. `viewOf(state)` is pure: the jobs running, the night to
 * come as the runner would play it, what is blocked and why, what ended.
 */
const GB = 1024 ** 3;
const TRACES_SHOWN = 30;
const FINISHED_SHOWN = 60;
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
export const projectOf = (cwd = "") => String(cwd).split(/[\\/]/).filter(Boolean).at(-1)?.replace(/^mcts-/, "") ?? "?";

const lastGood = new Map();
/** A JSON file, its last good reading when it is caught half written, `fallback` when it is missing. */
async function readJson(file, fallback) {
  for (let tries = 0; tries < 3; tries += 1) {
    try {
      const value = JSON.parse(await readFile(file, "utf8"));
      lastGood.set(file, value);
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  return lastGood.get(file) ?? fallback;
}

async function readArchive(home) {
  const folder = path.join(home, "done");
  const names = (await readdir(folder).catch(() => [])).filter((name) => name.endsWith(".json")).sort();
  return (await Promise.all(names.map((name) => readJson(path.join(folder, name), [])))).flat();
}

let cpu = { at: 0, reading: null, good: null };
/** The CPU's temperature, read at most every 10 s; a reading missed keeps the last one for a minute. */
async function cpuReading(now) {
  if (now - cpu.at > 10_000) {
    const reading = await readCpuTemperature({ url: heatSettings().url, timeoutMs: 2000 });
    cpu = { at: now, reading, good: reading ? { reading, at: now } : cpu.good };
  }
  return cpu.reading ?? (cpu.good && now - cpu.good.at < 60_000 ? cpu.good.reading : null);
}

/** A trace file's summary: its last heartbeat, its errors and slow calls in its last lines, its end. */
async function traceSummary(file, mtimeMs) {
  const events = (await tailOf(file, { lines: 400 })).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const beats = events.filter((event) => event.kind === "heartbeat" || event.kind === "start");
  return {
    file,
    mtimeMs,
    start: events.find((event) => event.kind === "start") ?? null,
    lastBeat: beats.at(-1) ?? null,
    counters: events.filter((event) => event.kind === "heartbeat").at(-1)?.counters ?? {},
    ended: events.find((event) => event.kind === "end" || event.kind === "crash") ?? null,
    problems: events.filter((event) => ["error", "warn", "slow", "crash"].includes(event.kind)).slice(-20),
  };
}

/** The trace files of the backlog's jobs and of the projects' hand runs (their logs/), the most recent first. */
async function readTraces(home, folders) {
  const found = [];
  const add = async (folder, keep) => {
    for (const name of (await readdir(folder).catch(() => [])).filter(keep)) {
      const file = path.join(folder, name);
      const info = await stat(file).catch(() => null);
      if (info) found.push({ file, name, mtimeMs: info.mtimeMs, id: name.includes("_") ? name.slice(name.indexOf("_") + 1, -".jsonl".length) : null });
    }
  };
  await add(path.join(home, "traces"), (name) => name.endsWith(".jsonl"));
  for (const folder of folders) await add(path.join(folder, "logs"), (name) => name.startsWith("trace-") && name.endsWith(".jsonl"));
  const recent = found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, TRACES_SHOWN);
  return Promise.all(recent.map(async (one) => ({ ...one, ...(await traceSummary(one.file, one.mtimeMs)) })));
}

/** A running job's output file: the one it recorded, else the newest `runs/*_<id>.txt` (a runner older than 26/10). */
function outputOf(job, runs) {
  if (job.output) return job.output;
  const name = runs.filter((one) => one.endsWith(`_${job.id}.txt`)).sort().at(-1);
  return name ? path.join("runs", name) : null;
}

/** Everything the views need, read from `home` without writing a byte. */
export async function readBacklog(home, { now = Date.now(), budget = threadBudget(), machine = true } = {}) {
  const [queue, archive, slots, journal, runs] = await Promise.all([readJson(path.join(home, "queue.json"), { jobs: [] }), readArchive(home), readSlots(home), readJournal(home, 300), readdir(path.join(home, "runs")).catch(() => [])]);
  const jobs = queue.jobs ?? [];
  const running = jobs.filter((job) => job.status === "running");
  const outputs = {};
  await Promise.all(
    running.map(async (job) => {
      const relative = outputOf(job, runs);
      if (!relative) return;
      const file = path.join(home, relative);
      const info = await stat(file).catch(() => null);
      outputs[job.id] = { file, mtimeMs: info?.mtimeMs ?? null, size: info?.size ?? 0, last: (await tailOf(file, { lines: 1, bytes: 16 * 1024 }))[0] ?? "" };
    }),
  );
  const folders = [...new Set([...jobs, ...archive.slice(-50)].map((job) => job.cwd).filter(Boolean))];
  const traces = await readTraces(home, folders);
  const pids = [...new Set([...slots.map((slot) => slot.pid), ...running.map((job) => job.runnerPid)].filter(Boolean))];
  return {
    home,
    now,
    budget,
    jobs,
    archive,
    slots,
    journal,
    outputs,
    traces,
    alivePids: pids.filter((pid) => alive(pid)),
    machine: machine ? { cores: os.cpus().length, freeGb: round(os.freemem() / GB), totalGb: round(os.totalmem() / GB), cpu: await cpuReading(now) } : null,
  };
}

const startOf = (job) => Date.parse(job.startedAt);

/**
 * The night to come as the runner plays it (bin/backlog.js): jobs side by side while their threads fit in the
 * budget, the next one by lopin's order (`nextJob`), each taking its estimate; a running job ends at its estimate
 * (a minute from now at the soonest). `[{ job, start, end, late }]`, then what would still wait, and why.
 */
export function projectNight(jobs, archive, budget, now) {
  const fit = (job) => Math.max(1, Math.min(job.threads ?? 1, budget));
  const length = (job) => Math.max(minutesOf(job.estimate), 1 / 60) * 60_000;
  const active = jobs.filter((job) => job.status === "running").map((job) => ({ job, end: Math.max(now + 60_000, (startOf(job) || now) + length(job)) }));
  const left = jobs.filter((job) => job.status !== "running" && !isFinished(job));
  const finished = [...archive];
  const order = [];
  for (let clock = now; ; ) {
    for (;;) {
      const used = active.reduce((sum, one) => sum + fit(one.job), 0);
      const job = nextJob(left, [...finished, ...active.map((one) => one.job)], clock);
      if (!job || (active.length > 0 && used + fit(job) > budget)) break;
      const end = clock + length(job);
      order.push({ job, start: clock, end, late: Boolean(job.due) && end > Date.parse(job.due) });
      active.push({ job, end });
      left.splice(left.indexOf(job), 1);
    }
    if (active.length === 0) {
      const byId = indexJobs(left, finished);
      return { order, waiting: left.map((job) => ({ job, ...holdOf(job, byId, clock) })) };
    }
    active.sort((a, b) => a.end - b.end);
    const first = active.shift();
    finished.push({ ...first.job, status: "done" });
    clock = first.end;
  }
}

const minutesSince = (now, ms) => (Number.isFinite(ms) ? round((now - ms) / 60_000) : null);

/** What the views show, from `readBacklog`'s state: pure. */
export function viewOf(state) {
  const { now, budget, jobs, archive, slots, journal = [], outputs = {}, traces = [], alivePids = [], machine = null } = state;
  const traceById = new Map(traces.filter((one) => one.id).map((one) => [one.id, one]));
  const today = new Date(now - new Date(now).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const running = jobs
    .filter((job) => job.status === "running")
    .map((job) => {
      const elapsedMin = minutesSince(now, startOf(job)) ?? 0;
      const estimateMin = minutesOf(job.estimate);
      const output = outputs[job.id] ?? null;
      const trace = traceById.get(job.id) ?? null;
      return {
        id: job.id,
        project: projectOf(job.cwd),
        cwd: job.cwd,
        command: job.command,
        threads: job.threads ?? 1,
        priority: job.priority ?? 2,
        startedAt: job.startedAt,
        elapsedMin,
        estimateMin,
        limitMin: job.limit ?? 120,
        progress: estimateMin > 0 ? elapsedMin / estimateMin : 0,
        over: elapsedMin > estimateMin,
        orphan: Boolean(job.runnerPid) && !alivePids.includes(job.runnerPid),
        runnerPid: job.runnerPid ?? null,
        childPid: job.childPid ?? null,
        output: output?.file ?? null,
        lastLine: output?.last ?? "",
        quietMin: minutesSince(now, output?.mtimeMs),
        beatMin: trace?.lastBeat ? minutesSince(now, Date.parse(trace.lastBeat.at)) : null,
        problems: trace?.problems.length ?? 0,
      };
    })
    .sort((a, b) => b.elapsedMin - a.elapsedMin);
  const { order, waiting } = projectNight(jobs, archive, budget, now);
  const planned = order
    .filter(({ job }) => job.status !== "running")
    .map(({ job, start, end, late }) => ({ id: job.id, project: projectOf(job.cwd), cwd: job.cwd, command: job.command, start, end, late, estimateMin: minutesOf(job.estimate), threads: job.threads ?? 1, priority: job.priority ?? 2, due: job.due ?? null, after: job.after ?? [] }));
  const held = waiting.map(({ job, reason, blocked }) => ({ id: job.id, project: projectOf(job.cwd), cwd: job.cwd, command: job.command, reason, blocked: Boolean(blocked), estimateMin: minutesOf(job.estimate), after: job.after ?? [] }));
  const finished = [...archive]
    .sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)))
    .slice(0, FINISHED_SHOWN)
    .map((job) => ({ id: job.id, project: projectOf(job.cwd), cwd: job.cwd, command: job.command, status: job.status, doneAt: job.doneAt, startedAt: job.startedAt ?? null, minutes: job.minutes, estimateMin: minutesOf(job.estimate), reason: job.reason ?? null, output: job.output ?? null, trace: job.trace ?? null }));
  const runners = [...new Set([...slots.map((slot) => slot.pid), ...jobs.filter((job) => job.status === "running").map((job) => job.runnerPid)].filter(Boolean))].map((pid) => {
    const mine = slots.filter((slot) => slot.pid === pid);
    const started = journal.filter((entry) => entry.pid === pid && entry.kind === "runner-started").at(-1)?.at;
    const since = started ?? mine.map((slot) => slot.since).sort()[0] ?? null;
    return { pid, runner: mine[0]?.runner ?? "mcts-backlog", alive: alivePids.includes(pid), threads: mine.reduce((sum, slot) => sum + slot.threads, 0), jobs: mine.length, since };
  });
  const endedToday = archive.filter((job) => String(job.doneAt).startsWith(today));
  return {
    now,
    machine: machine && { ...machine, budget },
    threads: { used: slots.reduce((sum, slot) => sum + slot.threads, 0), budget },
    runners,
    running,
    planned,
    blocked: held.filter((job) => job.blocked),
    waiting: held.filter((job) => !job.blocked),
    finished,
    journal: [...journal].reverse(),
    traces: traces.map(({ file, name, id, mtimeMs, start, lastBeat, counters, ended, problems }) => ({ file, name, id, quietMin: minutesSince(now, mtimeMs), start, lastBeat, counters, ended, problems })),
    counts: {
      running: running.length,
      planned: planned.length,
      waiting: held.filter((job) => !job.blocked).length,
      blocked: held.filter((job) => job.blocked).length,
      doneToday: endedToday.filter((job) => job.status === "done").length,
      failedToday: endedToday.filter((job) => job.status !== "done").length,
      nightEnd: order.length ? Math.max(...order.map((one) => one.end)) : null,
    },
  };
}

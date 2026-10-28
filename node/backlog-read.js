import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readJournal } from "./journal.js";
import { alive, heatSettings, readCpuTemperature, readSlots, threadBudget } from "./machine.js";
import { tailOf } from "./tail.js";
import { readWanted } from "./wanted.js";

/**
 * The backlog read from its folder (Sami, 26/10/2026: the backlog was a black box), for its views (node/backlog-view.js):
 * the queue and what surrounds it, never writing: the runner may be at work. A file caught half written keeps its last
 * good reading.
 */
const GB = 1024 ** 3;
const TRACES_SHOWN = 30;
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

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

/** A trace file's summary: its last heartbeat, its errors and slow calls in its last lines, its last progress, its end. */
export async function traceSummary(file, mtimeMs) {
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
    progress: events.filter((event) => event.kind === "progress").at(-1) ?? null,
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
  const [queue, archive, slots, wanted, journal, runs] = await Promise.all([readJson(path.join(home, "queue.json"), { jobs: [] }), readArchive(home), readSlots(home), readWanted(home), readJournal(home, 300), readdir(path.join(home, "runs")).catch(() => [])]);
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
    wanted,
    journal,
    outputs,
    traces,
    alivePids: pids.filter((pid) => alive(pid)),
    machine: machine ? { cores: os.cpus().length, freeGb: round(os.freemem() / GB), totalGb: round(os.totalmem() / GB), cpu: await cpuReading(now) } : null,
  };
}

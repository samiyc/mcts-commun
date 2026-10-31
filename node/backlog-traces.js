import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { tailOf } from "./tail.js";

/**
 * The traces the views show (node/backlog-read.js): the backlog's jobs' and the projects' hand runs' (their `logs/`), the
 * most recent first, each summed up from its last lines. Kept cheap for views that ask every 2 s (31/10/2026: 957 trace
 * files, each stat'ed and thirty of them tailed at every tick, 100 ms of the TUI's tick): the names begin with their
 * date, so only the newest ones and the running jobs' own are stat'ed, and a summary is kept while its file's size and
 * time do not move.
 */
const TRACES_SHOWN = 30;
const CANDIDATES = 2 * TRACES_SHOWN;

function parsed(line) {
  try {
    return [JSON.parse(line)];
  } catch {
    return [];
  }
}

/** A trace file's summary: its last heartbeat, its errors and slow calls in its last lines, its last progress, its end. */
export async function traceSummary(file, mtimeMs) {
  const events = (await tailOf(file, { lines: 400 })).flatMap(parsed);
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

const summaries = new Map();

/** The summary of `file` as of its stat `info`, read again only when its size or its time moved. */
async function summaryOf(file, info) {
  const kept = summaries.get(file);
  if (kept && kept.mtimeMs === info.mtimeMs && kept.size === info.size) return kept.summary;
  const summary = await traceSummary(file, info.mtimeMs);
  summaries.set(file, { mtimeMs: info.mtimeMs, size: info.size, summary });
  if (summaries.size > 4 * CANDIDATES) summaries.delete(summaries.keys().next().value);
  return summary;
}

/** The newest `CANDIDATES` files of `folder` among those `keep` accepts (their names begin with their date), and `always`. */
async function candidates(folder, keep, always = []) {
  const names = (await readdir(folder).catch(() => [])).filter(keep).sort().slice(-CANDIDATES);
  return [...new Set([...names.map((name) => path.join(folder, name)), ...always])];
}

const idOf = (name) => (name.includes("_") ? name.slice(name.indexOf("_") + 1, -".jsonl".length) : null);

/** `{ file, name, mtimeMs, size, id }` of each of `files` that exists. */
async function statted(files) {
  const found = await Promise.all(
    files.map(async (file) => {
      const info = await stat(file).catch(() => null);
      return info ? { file, name: path.basename(file), mtimeMs: info.mtimeMs, size: info.size, id: idOf(path.basename(file)) } : null;
    }),
  );
  return found.filter(Boolean);
}

/**
 * The traces to show: the backlog's (`home/traces`, the `running` jobs' own always among them, however old their
 * names) and the projects' hand runs' (`folders`, their `logs/`), the thirty most recent first, each with its summary.
 */
export async function readTraces(home, folders, running = []) {
  const own = running.map((job) => job.trace).filter(Boolean).map((file) => (path.isAbsolute(file) ? file : path.join(home, file)));
  const files = [await candidates(path.join(home, "traces"), (name) => name.endsWith(".jsonl"), own)];
  for (const folder of folders) files.push(await candidates(path.join(folder, "logs"), (name) => name.startsWith("trace-") && name.endsWith(".jsonl")));
  const recent = (await statted(files.flat())).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, TRACES_SHOWN);
  return Promise.all(recent.map(async (one) => ({ ...one, ...(await summaryOf(one.file, one)) })));
}

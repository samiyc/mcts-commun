import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { onPulse, traceSnapshot, traceTo } from "../src/trace.js";

/**
 * The library's trace written to a file (Sami, 26/10/2026), one JSON a line: the process's start, every event of
 * src/trace.js, a heartbeat every `heartbeatMs` (the counters, the memory), the end. Lines are buffered and written
 * every `everyMs`, and at once when the process exits or an uncaught error kills it.
 *
 * A synchronous computation lets no timer fire: the library's calls beat and write for it (`onPulse`). One stuck in a
 * loop no longer beats: the last heartbeat says since when, and what the counters were (the backlog's page and
 * terminal show the silence).
 *
 * Where: `MCTS_TRACE_FILE` (the backlog sets it for each job), else `logs/trace-YYYY-MM-DD-<pid>.jsonl` of the
 * current folder, which each project's .gitignore leaves out. `MCTS_TRACE_BEAT_MS` changes the heartbeat (tests).
 */
export function traceFileOf(env = process.env, cwd = process.cwd(), pid = process.pid, date = new Date()) {
  return env.MCTS_TRACE_FILE ? path.resolve(env.MCTS_TRACE_FILE) : path.join(cwd, "logs", `trace-${date.toISOString().slice(0, 10)}-${pid}.jsonl`);
}

/** Lines kept for `file`, written by `flush`: the folder is made with the first. */
function bufferTo(file) {
  let lines = [];
  let made = false;
  return {
    write: (event) => lines.push(`${JSON.stringify(event)}\n`),
    flush() {
      if (lines.length === 0) return;
      if (!made) mkdirSync(path.dirname(file), { recursive: true });
      made = true;
      appendFileSync(file, lines.join(""));
      lines = [];
    },
  };
}

/** Writes the process's crash and its end as they come: returns what stops it. */
function watchProcess({ note, beat, flush }) {
  const crashed = (error, origin) => {
    note("crash", { origin, message: error?.message ?? String(error), stack: error?.stack });
    flush();
  };
  const ended = (code) => {
    beat();
    note("end", { code });
    flush();
  };
  process.on("uncaughtExceptionMonitor", crashed);
  process.on("exit", ended);
  return () => {
    process.off("uncaughtExceptionMonitor", crashed);
    process.off("exit", ended);
  };
}

/** The files this process writes: the preload (node/trace-preload.js) and src/trace.js may both ask for one. */
const open = new Map();

export function traceToFile({ file = traceFileOf(), everyMs = 2_000, heartbeatMs = Number(process.env.MCTS_TRACE_BEAT_MS) || 30_000 } = {}) {
  if (open.has(file)) return open.get(file);
  const { write, flush } = bufferTo(file);
  const note = (kind, data = {}) => write({ at: new Date().toISOString(), scope: "process", kind, ...data });
  let beaten = Date.now();
  const beat = () => {
    beaten = Date.now();
    note("heartbeat", { rssMb: Math.round(process.memoryUsage().rss / 2 ** 20), uptimeS: Math.round(process.uptime()), counters: traceSnapshot().counters });
  };

  note("start", { pid: process.pid, cwd: process.cwd(), argv: process.argv.slice(1), node: process.version });
  flush();
  const remove = traceTo(write);
  const flushing = setInterval(flush, everyMs).unref();
  // The timer beats an idle process; one the library's calls just beat for is left alone.
  const beating = setInterval(() => Date.now() - beaten >= heartbeatMs / 2 && beat(), heartbeatMs).unref();
  const unpulse = onPulse(() => {
    beat();
    flush();
  }, heartbeatMs);
  const unwatch = watchProcess({ note, beat, flush });
  const handle = {
    file,
    flush,
    stop() {
      remove();
      unpulse();
      unwatch();
      clearInterval(flushing);
      clearInterval(beating);
      open.delete(file);
      flush();
    },
  };
  open.set(file, handle);
  return handle;
}

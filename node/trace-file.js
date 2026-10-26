import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { traceSnapshot, traceTo } from "../src/trace.js";

/**
 * The library's trace written to a file (Sami, 26/10/2026), one JSON a line: the process's start, every event of
 * src/trace.js, a heartbeat every `heartbeatMs` (the counters, the memory), the end. Lines are buffered and written
 * every `everyMs`, and at once when the process exits or an uncaught error kills it.
 *
 * A computation stuck in a synchronous loop no longer beats: the last heartbeat says since when, and what the
 * counters were (the backlog's page and terminal show the silence).
 *
 * Where: `MCTS_TRACE_FILE` (the backlog sets it for each job), else `logs/trace-YYYY-MM-DD-<pid>.jsonl` of the
 * current folder, which each project's .gitignore leaves out.
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

export function traceToFile({ file = traceFileOf(), everyMs = 2_000, heartbeatMs = 30_000 } = {}) {
  const { write, flush } = bufferTo(file);
  const note = (kind, data = {}) => write({ at: new Date().toISOString(), scope: "process", kind, ...data });
  const beat = () => note("heartbeat", { rssMb: Math.round(process.memoryUsage().rss / 2 ** 20), uptimeS: Math.round(process.uptime()), counters: traceSnapshot().counters });

  note("start", { pid: process.pid, cwd: process.cwd(), argv: process.argv.slice(1), node: process.version });
  const remove = traceTo(write);
  const flushing = setInterval(flush, everyMs).unref();
  const beating = setInterval(beat, heartbeatMs).unref();
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
  return {
    file,
    flush,
    stop() {
      remove();
      clearInterval(flushing);
      clearInterval(beating);
      process.off("uncaughtExceptionMonitor", crashed);
      process.off("exit", ended);
      flush();
    },
  };
}

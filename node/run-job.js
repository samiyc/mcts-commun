import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import path from "node:path";

/**
 * A job's process for the runner (node/runner.js): its command in its folder, its output to a file, stopped with every
 * process under it at its limit or when the runner aborts it (the guards, a cancel). And a job's `skipIf`, asked
 * before it starts.
 */
export const LIMIT = 120;

/** Stops `child` and every process it started. */
function kill(child) {
  if (process.platform === "win32") spawn(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/pid", String(child.pid), "/T", "/F"]);
  else child.kill("SIGTERM");
}

/**
 * Runs `job` in its folder, its output in `out`, its trace in `trace` (MCTS_TRACE_FILE): `{ pid, done }`, `done`
 * resolving with its exit code, "timeout" or "aborted".
 */
export function runJob(job, { out, trace }, { signal, threads, home }) {
  const output = createWriteStream(out);
  const env = { ...process.env, MCTS_THREADS: String(threads), LOPIN_THREADS: String(threads), MCTS_TRACE_FILE: trace, MCTS_BACKLOG_HOME: home };
  const child = spawn(job.command, { cwd: job.cwd, shell: true, env });
  const done = new Promise((resolve) => {
    let ended = null;
    const stop = (why, note) => {
      if (ended) return;
      ended = why;
      output.write(`\n[mcts-backlog] ${note}\n`);
      kill(child);
    };
    const minutes = job.limit ?? LIMIT;
    const timer = setTimeout(() => stop("timeout", `arrêté au bout de ${minutes} min`), minutes * 60_000);
    signal.addEventListener("abort", () => stop("aborted", `arrêté : ${signal.reason}`), { once: true });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => output.write(chunk));
    child.on("error", (error) => output.write(`\n[mcts-backlog] ${error.message}\n`));
    child.on("close", (code) => {
      clearTimeout(timer);
      output.end(() => resolve(ended ?? code));
    });
  });
  return { pid: child.pid, done };
}

const SKIP_CHECK_MS = 60_000;

/**
 * Asks `job.skipIf`, a command of its project run in its folder (Sami, 26/10/2026: lopin's stopIf on its duels, kept
 * in lopin): exit 0 skips the job, the first line it printed giving the reason; any other end, or a check that does
 * not answer within a minute, lets it run. `{ skip, reason }`.
 */
export function skipCheck(job, home) {
  return new Promise((resolve) => {
    const child = spawn(job.skipIf, { cwd: job.cwd, shell: true, env: { ...process.env, MCTS_BACKLOG_HOME: home } });
    let said = "";
    const timer = setTimeout(() => kill(child), SKIP_CHECK_MS);
    child.stdout.on("data", (chunk) => (said += chunk));
    child.on("error", () => {});
    child.on("close", (code) => {
      clearTimeout(timer);
      const reason = said.split(/\r?\n/).find((line) => line.trim()) ?? "skipIf";
      resolve({ skip: code === 0, reason: reason.trim(), code });
    });
  });
}

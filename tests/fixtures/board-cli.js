import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

/**
 * The board's command run end to end on a temporary board, shared by tests/board.test.js and tests/board-hook.test.js
 * (split on 31/10/2026: one file took 18 s of `npm test`).
 */
export const run = promisify(execFile);
// The hook also says how busy the machine is: here, a backlog that does not exist, never the machine's own.
process.env.MCTS_BACKLOG_HOME = path.join(os.tmpdir(), "board-test-no-backlog");
export const BOARD = fileURLToPath(new URL("../../bin/board.js", import.meta.url));
export const boardOf = (home) => (...args) => run(process.execPath, [BOARD, "--board", home, ...args]).then(({ stdout }) => stdout);
/** The hook as Claude Code runs it: the session's JSON on stdin. */
export const hook = (home, cwd) =>
  new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [BOARD, "--board", home, "--hook"], (error, stdout) => (error ? reject(error) : resolve(stdout)));
    child.stdin.end(JSON.stringify({ cwd, hook_event_name: "UserPromptSubmit" }));
  });

/** `work(home, board)` on a temporary board, removed after. */
export async function scratch(work) {
  const home = await mkdtemp(path.join(os.tmpdir(), "board-"));
  try {
    await work(home, boardOf(home));
  } finally {
    await rm(home, { recursive: true, force: true, maxRetries: 5 });
  }
}

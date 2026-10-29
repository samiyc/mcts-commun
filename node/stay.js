import { readFileSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { alive, withLock } from "./machine.js";

/**
 * The permanent runner (Sami, 29/10/2026: started with the PC, it waits for the next jobs when the queue is empty):
 * `<home>/stay.json`, `{ pid, since }`, written when `mcts-backlog --stay` starts. A second `--stay` finds it and goes,
 * so that a start at every logon is safe; the file of a dead pid counts for nothing. The views read it too: a runner
 * at rest writes nothing to the journal, its start soon out of the lines they read.
 */
const fileOf = (home) => path.join(home, "stay.json");

/** The permanent runner at work, `{ pid, since }`, or null. */
export async function readStay(home) {
  try {
    const stay = JSON.parse(await readFile(fileOf(home), "utf8"));
    return alive(stay.pid) ? stay : null;
  } catch {
    return null;
  }
}

/** Makes this process the permanent runner, unless one is at work: null if it is now, else the other `{ pid, since }`. */
export const claimStay = (home, pid = process.pid) =>
  withLock(home, async () => {
    const other = await readStay(home);
    if (other && other.pid !== pid) return other;
    await writeFile(fileOf(home), JSON.stringify({ pid, since: new Date().toISOString() }));
    return null;
  });

/**
 * Gives the place back when this process ends, if it is still its own: at its exit, at Ctrl+C, when its window is
 * closed (SIGHUP on Windows). Left behind, the file of a dead pid counts for nothing, but a pid comes back one day.
 */
export function releaseStayOnExit(home, pid = process.pid) {
  process.once("exit", () => {
    try {
      if (JSON.parse(readFileSync(fileOf(home), "utf8")).pid === pid) rmSync(fileOf(home), { force: true });
    } catch {
      // No file, or another's: nothing to give back.
    }
  });
  for (const signal of ["SIGINT", "SIGHUP"]) process.once(signal, () => process.exit(130));
}

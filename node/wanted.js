import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { alive, readSlots, withLock } from "./machine.js";

/**
 * The threads sessions wait for (Sami, 27/10/2026: a short test must pass before the queue's next jobs). While
 * `mcts-backlog --slot` waits, its want sits in `<home>/wanted.json`, `{ wanted: [{ pid, id, threads, since }] }`,
 * under the slots' lock; the runner gives it the threads that come free, and if need be frees some (node/preempt.js).
 * The wants of dead processes are left out, as the slots are.
 */
const fileOf = (home) => path.join(home, "wanted.json");
const mine = (want, pid, id) => want.pid === pid && want.id === id;

/** The wants of live processes: `[{ pid, id, threads, since }]`. */
export async function readWanted(home) {
  try {
    const { wanted } = JSON.parse(await readFile(fileOf(home), "utf8"));
    return wanted.filter((want) => alive(want.pid));
  } catch {
    return [];
  }
}

// Written in place, not renamed: a file being read refuses a rename on Windows (EPERM), not a write (27/10/2026).
const write = (home, wanted) => writeFile(fileOf(home), JSON.stringify({ wanted }, null, 1));

/** Records that process `pid` waits for `threads` threads, for `id`. */
export const wantSlot = (home, { pid, id, threads }) =>
  withLock(home, async () => write(home, [...(await readWanted(home)).filter((want) => !mine(want, pid, id)), { pid, id, threads, since: new Date().toISOString() }]));

/** Takes back the want of `pid` for `id`. */
export const dropWant = (home, pid, id) => withLock(home, async () => write(home, (await readWanted(home)).filter((want) => !mine(want, pid, id))));

const sum = (list) => list.reduce((total, one) => total + one.threads, 0);

/** The threads now: `{ used }` by the slots of live processes, `{ wanted }` by the sessions that wait. */
export async function threadsNow(home) {
  return { used: sum(await readSlots(home)), wanted: sum(await readWanted(home)) };
}

/** Whether a job of `threads` may start now: the threads sessions wait for come first. */
export async function roomFor(home, budget, threads) {
  const { used, wanted } = await threadsNow(home);
  return wanted === 0 || used + wanted + threads <= budget;
}

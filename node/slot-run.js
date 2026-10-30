import { spawn } from "node:child_process";
import { createJournal, readJournal } from "./journal.js";
import { readSlots, threadBudget, waitForSlot } from "./machine.js";
import { kill } from "./run-job.js";
import { dropWant, inSeries, wantSlot } from "./wanted.js";

/**
 * A command run in the machine's slots, beside the queue (Sami, 27/10/2026: the sessions ran their tests beside a queue
 * holding all 18 threads; one budget for the machine, whoever runs). `mcts-backlog --slot N -- COMMAND` waits for N
 * free threads in slots.json (the runners' table, node/machine.js), runs the command in the foreground with
 * MCTS_THREADS=N, gives the threads back when it ends, and exits with its code. Windows cannot cap a process: the
 * sessions keep to the budget by passing through here. While it waits, its want is known to the runner
 * (node/wanted.js), which serves it before the queue's next job and frees young jobs if need be (node/preempt.js).
 * Its start and end go to the journal (slot-started, slot-ended), for the views' Tests tab (Sami, 28/10/2026). One
 * started again less than 2 min after the same id ended is in a series, and waits like a job (node/wanted.js).
 *
 * A short test is short (Sami, 28/10/2026: "never again a job of an hour on 12 threads in the Tests tab"): `SLOT_MAX_THREADS`
 * threads at most, else refused (a job, `--add`); stopped at `SLOT_MAX_MINUTES`, its process tree killed, exit code
 * `SLOT_STOPPED` (`MCTS_SLOT_LIMIT_MS` may only shorten it, for the tests).
 */
export const SLOT_MAX_THREADS = 4;
export const SLOT_MAX_MINUTES = 15;
const SLOT_STOPPED = 124;

/** The time a short test may run, in ms. */
const limitMs = () => Math.min(SLOT_MAX_MINUTES * 60_000, Number(process.env.MCTS_SLOT_LIMIT_MS) || Infinity);
export async function runInSlot({ home, budget = threadBudget(), threads, id, command, cwd = process.cwd(), say = console.error }) {
  if (threads > SLOT_MAX_THREADS) {
    say(`mcts-backlog --slot : ${threads} fils, c'est un job, pas un test court (${SLOT_MAX_THREADS} au plus) : mets-le dans la file, mcts-backlog --add (docs/backlog.md)`);
    return 2;
  }
  const asked = Math.min(threads, budget);
  const asking = Date.now();
  const series = inSeries(await readJournal(home, 200).catch(() => []), id, asking);
  await wantSlot(home, { pid: process.pid, id, threads: asked, series });
  const slot = await waitForSlot({
    home,
    budget,
    id,
    threads: asked,
    runner: "session",
    everyMs: 1_000,
    onWait: (slots) => say(`mcts-backlog --slot : attend ${asked} fil(s), ${usedOf(slots)}/${budget} pris ; ${series ? "en série, il attend comme un job" : "la file lui laisse la place"}`),
  }).finally(() => dropWant(home, process.pid, id));
  const started = Date.now();
  note(home, "slot-started", { id, threads: asked, waitedMin: minutesSince(asking, started), cwd, command, series });
  let ended = { code: 1, stopped: false };
  try {
    ended = await runShort({ command, cwd, threads, say });
    return ended.code;
  } finally {
    await slot.release();
    note(home, "slot-ended", { id, threads: asked, minutes: minutesSince(started, Date.now()), code: ended.code, stopped: ended.stopped });
  }
}

/** The command in the foreground, stopped at the limit: `{ code, stopped }`. */
function runShort({ command, cwd, threads, say }) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: "inherit", env: { ...process.env, MCTS_THREADS: String(threads) } });
    let stopped = false;
    const timer = setTimeout(() => {
      stopped = true;
      say(`mcts-backlog --slot : arrêté après ${SLOT_MAX_MINUTES} min, un test court ne dure pas ça : mets-le dans la file, mcts-backlog --add (docs/backlog.md)`);
      kill(child);
    }, limitMs());
    const done = (code) => {
      clearTimeout(timer);
      resolve({ code: stopped ? SLOT_STOPPED : code, stopped });
    };
    child.on("exit", (exit) => done(exit ?? 1));
    child.on("error", () => done(1));
  });
}

const minutesSince = (from, to) => Math.round(((to - from) / 60_000) * 100) / 100;

/** A line in the journal; a journal that cannot be written never fails the command. */
function note(home, kind, data) {
  try {
    createJournal(home)(kind, data);
  } catch {
    // The test matters, its line in the journal does not.
  }
}

const usedOf = (slots) => slots.reduce((sum, slot) => sum + slot.threads, 0);

/** The machine's threads now: `{ used, budget, free }`, from the slots of live processes. */
export async function machineLoad(home, budget = threadBudget()) {
  const used = usedOf(await readSlots(home));
  return { used, budget, free: Math.max(0, budget - used) };
}

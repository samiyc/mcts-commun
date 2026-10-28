import { spawn } from "node:child_process";
import { createJournal } from "./journal.js";
import { readSlots, threadBudget, waitForSlot } from "./machine.js";
import { dropWant, wantSlot } from "./wanted.js";

/**
 * A command run in the machine's slots, beside the queue (Sami, 27/10/2026: the sessions ran their tests beside a queue
 * holding all 18 threads; one budget for the machine, whoever runs). `mcts-backlog --slot N -- COMMAND` waits for N
 * free threads in slots.json (the runners' table, node/machine.js), runs the command in the foreground with
 * MCTS_THREADS=N, gives the threads back when it ends, and exits with its code. Windows cannot cap a process: the
 * sessions keep to the budget by passing through here. While it waits, its want is known to the runner
 * (node/wanted.js), which serves it before the queue's next job and frees young jobs if need be (node/preempt.js).
 * Its start and end go to the journal (slot-started, slot-ended), for the views' Tests tab (Sami, 28/10/2026).
 */
export async function runInSlot({ home, budget = threadBudget(), threads, id, command, cwd = process.cwd(), say = console.error }) {
  const asked = Math.min(threads, budget);
  const asking = Date.now();
  await wantSlot(home, { pid: process.pid, id, threads: asked });
  const slot = await waitForSlot({
    home,
    budget,
    id,
    threads: asked,
    runner: "session",
    everyMs: 1_000,
    onWait: (slots) => say(`mcts-backlog --slot : attend ${asked} fil(s), ${usedOf(slots)}/${budget} pris ; la file lui laisse la place`),
  }).finally(() => dropWant(home, process.pid, id));
  const started = Date.now();
  note(home, "slot-started", { id, threads: asked, waitedMin: minutesSince(asking, started), cwd, command });
  let code = 1;
  try {
    code = await new Promise((resolve) => {
      const child = spawn(command, { cwd, shell: true, stdio: "inherit", env: { ...process.env, MCTS_THREADS: String(threads) } });
      child.on("exit", (exit) => resolve(exit ?? 1));
      child.on("error", () => resolve(1));
    });
    return code;
  } finally {
    await slot.release();
    note(home, "slot-ended", { id, threads: asked, minutes: minutesSince(started, Date.now()), code });
  }
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

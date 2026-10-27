import { spawn } from "node:child_process";
import { readSlots, threadBudget, waitForSlot } from "./machine.js";

/**
 * A command run in the machine's slots, beside the queue (Sami, 27/10/2026: the sessions ran their tests beside a queue
 * holding all 18 threads; one budget for the machine, whoever runs). `mcts-backlog --slot N -- COMMAND` waits for N
 * free threads in slots.json (the runners' table, node/machine.js), runs the command in the foreground with
 * MCTS_THREADS=N, gives the threads back when it ends, and exits with its code. Windows cannot cap a process: the
 * sessions keep to the budget by passing through here.
 */
export async function runInSlot({ home, budget = threadBudget(), threads, id, command, cwd = process.cwd(), say = console.error }) {
  const slot = await waitForSlot({
    home,
    budget,
    id,
    threads: Math.min(threads, budget),
    runner: "session",
    everyMs: 2_000,
    onWait: (slots) => say(`mcts-backlog --slot : attend ${threads} fil(s), ${usedOf(slots)}/${budget} pris (${slots.map((one) => one.id).join(", ")})`),
  });
  try {
    return await new Promise((resolve) => {
      const child = spawn(command, { cwd, shell: true, stdio: "inherit", env: { ...process.env, MCTS_THREADS: String(threads) } });
      child.on("exit", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });
  } finally {
    await slot.release();
  }
}

const usedOf = (slots) => slots.reduce((sum, slot) => sum + slot.threads, 0);

/** The machine's threads now: `{ used, budget, free }`, from the slots of live processes. */
export async function machineLoad(home, budget = threadBudget()) {
  const used = usedOf(await readSlots(home));
  return { used, budget, free: Math.max(0, budget - used) };
}

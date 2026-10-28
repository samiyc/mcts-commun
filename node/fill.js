import { withLearned } from "../src/estimate.js";
import { holdOf, indexJobs, minutesOf, smithOrder } from "../src/schedule.js";
import { readSlots } from "./machine.js";
import { threadsNow } from "./wanted.js";

/**
 * A gap filled while the next job waits for threads a session holds (Sami, 28/10/2026: the machine ran at 6 threads of
 * 18 for 40 min, the next job wanting 16 while codingame's arena held 6, and the diagnose jobs of 8 threads waited
 * behind it). When the runner's next job would fit if the others' slots (sessions' tests, another runner) were free,
 * a ready job that fits in the threads free now and is short (`FILL_MINUTES` at most, as learned) starts meanwhile:
 * the next job then waits at most that long once the threads come back. When the next job waits for the runner's own
 * jobs, nothing fills: it would wait for ever behind a stream of small ones.
 */
export const FILL_MINUTES = 15;

const threadsOf = (job, budget) => Math.max(1, Math.min(job.threads ?? 1, budget));

/**
 * The job to start in the gap, pure, or null: `ready` in the runner's order, `next` the job that waits, `ours` the
 * threads the runner's jobs hold, `others` those the others hold, `free` those free for a job now.
 */
export function fillerOf({ ready, next, ours, others, free, budget }) {
  if (!next || others === 0 || ours + threadsOf(next, budget) > budget) return null;
  return ready.find((job) => job.id !== next.id && threadsOf(job, budget) <= free && minutesOf(job.estimate) <= FILL_MINUTES) ?? null;
}

/** The ready jobs of the queue but those running, by their lengths learned, in the runner's order. */
async function readyOf({ queue, running }, current) {
  const archive = await queue.readArchive();
  const waiting = withLearned(
    current.jobs.filter((job) => job.status !== "running" && !running.has(job.id) && !job.machine),
    archive,
  );
  const byId = indexJobs(waiting, [...archive, ...current.jobs.filter((one) => one.status === "running")]);
  const now = Date.now();
  return smithOrder(waiting.filter((job) => !holdOf(job, byId, now)));
}

/**
 * Starts a short job in the gap while `next` waits for threads others hold, with `start` (the runner's tryStart):
 * true if one started. Said in the journal (`gap-filled`).
 */
export async function fillGap(runner, current, next, start) {
  const { home, budget, journal } = runner;
  const slots = await readSlots(home);
  const ours = slots.filter((slot) => slot.pid === process.pid).reduce((sum, slot) => sum + slot.threads, 0);
  const others = slots.reduce((sum, slot) => sum + slot.threads, 0) - ours;
  const { wanted } = await threadsNow(home);
  const filler = fillerOf({ ready: await readyOf(runner, current), next, ours, others, free: budget - ours - others - wanted, budget });
  if (!filler || !(await start(runner, filler))) return false;
  journal("gap-filled", { id: filler.id, threads: threadsOf(filler, budget), waiting: next.id, waitingThreads: threadsOf(next, budget), others });
  return true;
}

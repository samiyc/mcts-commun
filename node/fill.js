import { withLearned } from "../src/estimate.js";
import { holdOf, indexJobs, minutesOf, smithOrder } from "../src/schedule.js";
import { readSlots } from "./machine.js";
import { threadsNow } from "./wanted.js";

/**
 * A gap filled while the next job waits for threads (Sami, 28/10/2026: the machine ran at 6 threads of 18 for 40 min,
 * the next job wanting 16 while codingame's arena held 6, and the diagnose jobs of 8 threads waited behind it). A ready
 * job that fits in the threads free now and is short (`FILL_MINUTES` at most, as learned) starts meanwhile, when:
 * - the next job waits for threads others hold (sessions' tests, another runner): it then waits at most that long once
 *   the threads come back;
 * - or, since 31/10/2026, the next job waits for the runner's own jobs and the filler leaves it its start: it ends
 *   before the next job could start anyway, or still leaves it its threads then (EASY backfilling). A stream of small
 *   jobs cannot keep it out: each one must fit in what the next job will not need.
 */
export const FILL_MINUTES = 15;
const MS = 60_000;

const threadsOf = (job, budget) => Math.max(1, Math.min(job.threads ?? 1, budget));

/** When `next` could start were nothing added: `now` if it fits, else the end of the running job that frees enough, else Infinity. */
function startOf(next, { free, running, now, budget }) {
  let room = free;
  if (room >= threadsOf(next, budget)) return now;
  for (const run of [...running].sort((a, b) => a.end - b.end)) {
    room += run.threads;
    if (room >= threadsOf(next, budget)) return run.end;
  }
  return Infinity;
}

/** Whether `job`, started now, leaves `next` its start at `at`: it ends before, or still leaves it its threads then. */
function harmless(job, next, at, { free, running, now, budget }) {
  if (now + minutesOf(job.estimate) * MS <= at) return true;
  const freeThen = free + running.filter((run) => run.end <= at).reduce((sum, run) => sum + run.threads, 0);
  return threadsOf(job, budget) <= freeThen - threadsOf(next, budget);
}

/**
 * The job to start in the gap, pure, or null: `ready` in the runner's order, `next` the job that waits, `free` the
 * threads free for a job now, `running` the runner's own jobs `[{ threads, end }]` with the ends their estimates give.
 * The next job's start is unknown (Infinity) when it waits for others' threads: a filler of `FILL_MINUTES` at most then
 * delays it by its length at most. Known, a filler that leaves it its start may be as long as it likes.
 */
export function fillerOf({ ready, next, free, budget, running = [], now = Date.now() }) {
  if (!next) return null;
  const settings = { free, running, now, budget };
  const at = startOf(next, settings);
  const fits = (job) => job.id !== next.id && threadsOf(job, budget) <= free;
  const allowed = (job) => (at === Infinity ? minutesOf(job.estimate) <= FILL_MINUTES : harmless(job, next, at, settings));
  return ready.find((job) => fits(job) && allowed(job)) ?? null;
}

/** The ready jobs of the queue but those running, by their lengths learned, in the runner's order; and the running ones' ends. */
async function readyOf({ queue, running }, current) {
  const archive = await queue.readArchive();
  const learned = withLearned(
    current.jobs.filter((job) => !job.machine),
    archive,
  );
  const waiting = learned.filter((job) => job.status !== "running" && !running.has(job.id));
  const byId = indexJobs(waiting, [...archive, ...current.jobs.filter((one) => one.status === "running")]);
  const now = Date.now();
  const ends = learned.filter((job) => running.has(job.id)).map((job) => ({ threads: running.get(job.id).threads, end: running.get(job.id).started + minutesOf(job.estimate) * MS }));
  return { ready: smithOrder(waiting.filter((job) => !holdOf(job, byId, now))), ends, now };
}

/**
 * Starts a short job in the gap while `next` waits for threads, with `start` (the runner's tryStart): true if one
 * started. Said in the journal (`gap-filled`).
 */
export async function fillGap(runner, current, next, start) {
  const { home, budget, journal } = runner;
  const slots = await readSlots(home);
  const ours = slots.filter((slot) => slot.pid === process.pid).reduce((sum, slot) => sum + slot.threads, 0);
  const others = slots.reduce((sum, slot) => sum + slot.threads, 0) - ours;
  const { wanted } = await threadsNow(home);
  const { ready, ends, now } = await readyOf(runner, current);
  const filler = fillerOf({ ready, next, free: budget - ours - others - wanted, budget, running: ends, now });
  if (!filler || !(await start(runner, filler))) return false;
  journal("gap-filled", { id: filler.id, threads: threadsOf(filler, budget), waiting: next.id, waitingThreads: threadsOf(next, budget), others });
  return true;
}

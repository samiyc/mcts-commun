import { threadsNow } from "./wanted.js";

/**
 * Threads freed for a short test (Sami, 27/10/2026: free the queue's jobs started less than 5 minutes ago, so that short
 * tests pass; the queue goes on once the threads are back). When sessions wait for more threads than are free, the
 * runner stops its youngest jobs started less than `PREEMPT_MINUTES` ago, each at most `PREEMPT_MAX` times (else a
 * burst of tests could restart it for ever); they go back to the queue and start again later, from the beginning.
 * Only the runner's own jobs: another runner's (lopin's) are never stopped.
 */
export const PREEMPT_MINUTES = 5;
export const PREEMPT_MAX = 2;
export const PREEMPTED = "laissé à un test court (mcts-backlog --slot)";

/**
 * The ids of the jobs to stop, pure: `running` `[{ id, started, threads, stopping }]` (`stopping`: already being
 * stopped, its threads soon free), `missing` the threads the waiting sessions lack, `stops` how often each was stopped.
 */
export function toPreempt({ running, missing, stops, now }) {
  let left = missing - running.filter((one) => one.stopping).reduce((sum, one) => sum + one.threads, 0);
  const young = running
    .filter((one) => !one.stopping && now - one.started < PREEMPT_MINUTES * 60_000 && (stops.get(one.id) ?? 0) < PREEMPT_MAX)
    .sort((a, b) => b.started - a.started);
  const chosen = [];
  for (const one of young) {
    if (left <= 0) break;
    chosen.push(one.id);
    left -= one.threads;
  }
  return chosen;
}

/** Stops the runner's young jobs the waiting sessions need, and says so in the journal. */
export async function preemptFor(runner) {
  const { used, wanted } = await threadsNow(runner.home);
  const missing = used + wanted - runner.budget;
  if (wanted === 0 || missing <= 0) return;
  const running = [...runner.running.entries()].map(([id, one]) => ({ id, started: one.started, threads: one.threads, stopping: Boolean(one.stops.preempt || one.stops.cancel) }));
  for (const id of toPreempt({ running, missing, stops: runner.preempted, now: Date.now() })) {
    const one = runner.running.get(id);
    runner.preempted.set(id, (runner.preempted.get(id) ?? 0) + 1);
    one.stops.preempt = PREEMPTED;
    runner.journal("job-preempting", { id, threads: one.threads, wanted });
    one.guard.abort(PREEMPTED);
  }
}

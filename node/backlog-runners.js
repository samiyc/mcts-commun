/**
 * The runners at work, for the views (node/backlog-view.js). A runner holding no thread is still at work when it
 * waits for the threads of its next job (Sami, 28/10/2026: "on n'utilise pas tous les threads ?"; the runner waited
 * for 16 threads, the views showed no runner but a session's slot). Pure.
 */

// What only a runner writes: its start, its jobs, its waits, its guards ("added" or "cancel-asked" come from anyone).
const RUNNER_KINDS = new Set(["runner-started", "job-started", "job-ended", "job-preempting", "job-preempted", "job-requeued", "job-skipped", "job-cancelled", "slot-waiting", "heat-alert", "heat-resumed", "memory-stop", "orphans-requeued", "runner-idle"]);

/** The pids of the runners the journal shows at work and not ended: its start may be long past the lines read. */
export function startedRunners(journal = []) {
  const open = new Set();
  for (const entry of journal) {
    if (entry.kind === "runner-ended") open.delete(entry.pid);
    else if (RUNNER_KINDS.has(entry.kind)) open.add(entry.pid);
  }
  return [...open];
}

const held = (slots) => slots.reduce((sum, slot) => sum + slot.threads, 0);

/**
 * What runner `pid` waits for: the next job of the night, when its threads are more than those free and the others'
 * slots stand in its way, with who holds them; else null. Waiting for its own jobs to end is a queue at work, not a
 * wait (28/10/2026: « attend 1 fils (0 libres) » shown all night). Read from the queue, not the journal: a runner
 * says slot-waiting once a job.
 */
function waitingOf({ slots, next, budget, pid }) {
  if (!next) return null;
  const free = budget - held(slots);
  const others = slots.filter((slot) => slot.pid !== pid);
  if (next.threads <= free || next.threads > free + held(others)) return null;
  return { id: next.id, threads: next.threads, free, holders: others.map(({ id, threads, runner }) => ({ id, threads, runner })) };
}

/** Since when runner `pid` works: its start in the journal's lines, else in the whole journal, else its first slot. */
function sinceOf({ journal, starts, pid, mine }) {
  const started = journal.filter((entry) => entry.pid === pid && entry.kind === "runner-started").at(-1)?.at ?? starts[pid];
  return started ?? mine.map((slot) => slot.since).sort()[0] ?? null;
}

/**
 * The runners at work: those holding slots or running jobs, alive or not, those alive the journal says started, and
 * the permanent one (`stay`, node/stay.js); since when, and for a runner of the queue, the next job it waits threads
 * for (`next`, the night's first).
 */
export function runnersOf({ slots, jobs, journal, alivePids, next = null, budget = Infinity, starts = {}, stay = null }) {
  const held = [...slots.map((slot) => slot.pid), ...jobs.filter((job) => job.status === "running").map((job) => job.runnerPid)];
  const idle = [...startedRunners(journal), stay?.pid].filter((pid) => alivePids.includes(pid));
  const pids = [...new Set([...held, ...idle].filter(Boolean))];
  return pids.map((pid) => {
    const mine = slots.filter((slot) => slot.pid === pid);
    const since = sinceOf({ journal, starts, pid, mine });
    const runner = mine[0]?.runner ?? "mcts-backlog";
    const waiting = runner === "session" || !alivePids.includes(pid) ? null : waitingOf({ slots, next, budget, pid });
    return { pid, runner, alive: alivePids.includes(pid), threads: mine.reduce((sum, slot) => sum + slot.threads, 0), jobs: mine.length, since, waiting, stay: pid === stay?.pid };
  });
}

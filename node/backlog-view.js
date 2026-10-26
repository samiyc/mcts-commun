import { holdOf, indexJobs, isFinished, minutesOf, nextJob } from "../src/schedule.js";
import { loadOf } from "./backlog-load.js";

export { readBacklog } from "./backlog-read.js";

/**
 * What the backlog's page, its terminal view and `--list` show (Sami, 26/10/2026: the backlog was a black box).
 * `readBacklog(home)` (node/backlog-read.js) reads the machine's queue and what surrounds it, never writing.
 * `viewOf(state)` is pure: the jobs running, the night to come as the runner would play it, what is blocked and why,
 * what ended.
 */
const FINISHED_SHOWN = 60;
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
export const projectOf = (cwd = "") => String(cwd).split(/[\\/]/).filter(Boolean).at(-1)?.replace(/^mcts-/, "") ?? "?";

const startOf = (job) => Date.parse(job.startedAt);
const lengthOf = (job) => Math.max(minutesOf(job.estimate), 1 / 60) * 60_000;

/**
 * The night to come as the runner plays it (bin/backlog.js): jobs side by side while their threads fit in the
 * budget, the next one by lopin's order (`nextJob`), each taking its estimate; a running job ends at its estimate
 * (a minute from now at the soonest). `[{ job, start, end, late }]`, then what would still wait, and why.
 */
export function projectNight(jobs, archive, budget, now) {
  const night = {
    budget,
    active: jobs.filter((job) => job.status === "running").map((job) => ({ job, end: Math.max(now + 60_000, (startOf(job) || now) + lengthOf(job)) })),
    left: jobs.filter((job) => job.status !== "running" && !isFinished(job)),
    finished: [...archive],
    order: [],
  };
  for (let clock = now; ; ) {
    startReady(night, clock);
    if (night.active.length === 0) {
      const byId = indexJobs(night.left, night.finished);
      return { order: night.order, waiting: night.left.map((job) => ({ job, ...holdOf(job, byId, clock) })) };
    }
    night.active.sort((a, b) => a.end - b.end);
    const first = night.active.shift();
    night.finished.push({ ...first.job, status: "done" });
    clock = first.end;
  }
}

/** Starts at `clock` every job the order picks while its threads fit beside the ones running. */
function startReady(night, clock) {
  const threadsOf = (job) => Math.max(1, Math.min(job.threads ?? 1, night.budget));
  const { active, left, finished, order } = night;
  for (;;) {
    const used = active.reduce((sum, one) => sum + threadsOf(one.job), 0);
    const job = nextJob(left, [...finished, ...active.map((one) => one.job)], clock);
    if (!job || (active.length > 0 && used + threadsOf(job) > night.budget)) return;
    const end = clock + lengthOf(job);
    order.push({ job, start: clock, end, late: Boolean(job.due) && end > Date.parse(job.due) });
    active.push({ job, end });
    left.splice(left.indexOf(job), 1);
  }
}

const minutesSince = (now, ms) => (Number.isFinite(ms) ? round((now - ms) / 60_000) : null);

/** What every view says of a job: its name, project, folder, command. */
const named = (job) => ({ id: job.id, project: projectOf(job.cwd), cwd: job.cwd, command: job.command });

/** A running job: how far it is against its estimate, its runner, its output and its trace. */
function runningOf(job, context) {
  return {
    ...named(job),
    threads: job.threads ?? 1,
    priority: job.priority ?? 2,
    startedAt: job.startedAt,
    ...timeOf(job, context.now),
    orphan: Boolean(job.runnerPid) && !context.alivePids.includes(job.runnerPid),
    ...processesOf(job),
    ...filesOf(job, context),
  };
}

/** Its time: elapsed, estimated, its limit, how far, past its estimate or not. */
function timeOf(job, now) {
  const elapsedMin = minutesSince(now, startOf(job)) ?? 0;
  const estimateMin = minutesOf(job.estimate);
  return { elapsedMin, estimateMin, limitMin: job.limit ?? 120, progress: estimateMin > 0 ? elapsedMin / estimateMin : 0, over: elapsedMin > estimateMin };
}

/** Its output (the file, its last line, how long it has been quiet) and its trace (the last heartbeat, incidents). */
const filesOf = (job, { now, outputs, traceById }) => ({ ...outputOf(outputs[job.id], now), ...traceStateOf(traceById.get(job.id), now) });

function outputOf(output, now) {
  if (!output) return { output: null, lastLine: "", quietMin: null };
  return { output: output.file ?? null, lastLine: output.last ?? "", quietMin: minutesSince(now, output.mtimeMs) };
}

function traceStateOf(trace, now) {
  if (!trace) return { beatMin: null, problems: 0 };
  return { beatMin: trace.lastBeat ? minutesSince(now, Date.parse(trace.lastBeat.at)) : null, problems: trace.problems.length };
}

const processesOf = (job) => ({ runnerPid: job.runnerPid ?? null, childPid: job.childPid ?? null });

const plannedOf = ({ job, start, end, late }) => ({ ...named(job), start, end, late, estimateMin: minutesOf(job.estimate), threads: job.threads ?? 1, priority: job.priority ?? 2, due: job.due ?? null, after: job.after ?? [] });
/** The jobs for another machine (node/remote.js), waiting there or to be sent. */
const elsewhere = (jobs) =>
  jobs
    .filter((job) => job.machine && !isFinished(job))
    .map((job) => ({ job, blocked: false, reason: job.sentAt ? `sur ${job.machine}, envoyé ${job.sentAt.slice(11)} (--pull ${job.machine})` : `pour ${job.machine} (--push ${job.machine})` }));

const heldOf = ({ job, reason, blocked }) => ({ ...named(job), reason, blocked: Boolean(blocked), estimateMin: minutesOf(job.estimate), after: job.after ?? [] });
const finishedOf = (job) => ({
  ...named(job),
  status: job.status,
  doneAt: job.doneAt,
  startedAt: job.startedAt ?? null,
  minutes: job.minutes,
  estimateMin: minutesOf(job.estimate),
  reason: job.reason ?? null,
  output: job.output ?? null,
  trace: job.trace ?? null,
});

/** The runners at work: those holding slots or running jobs, alive or not, since when. */
function runnersOf({ slots, jobs, journal, alivePids }) {
  const pids = [...new Set([...slots.map((slot) => slot.pid), ...jobs.filter((job) => job.status === "running").map((job) => job.runnerPid)].filter(Boolean))];
  return pids.map((pid) => {
    const mine = slots.filter((slot) => slot.pid === pid);
    const started = journal.filter((entry) => entry.pid === pid && entry.kind === "runner-started").at(-1)?.at;
    const since = started ?? mine.map((slot) => slot.since).sort()[0] ?? null;
    return { pid, runner: mine[0]?.runner ?? "mcts-backlog", alive: alivePids.includes(pid), threads: mine.reduce((sum, slot) => sum + slot.threads, 0), jobs: mine.length, since };
  });
}

const traceOf = (now) => ({ file, name, id, mtimeMs, start, lastBeat, counters, ended, problems }) => ({ file, name, id, quietMin: minutesSince(now, mtimeMs), start, lastBeat, counters, ended, problems });

function countsOf({ now, archive, running, planned, held, order }) {
  const today = new Date(now - new Date(now).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const endedToday = archive.filter((job) => String(job.doneAt).startsWith(today));
  return {
    running: running.length,
    planned: planned.length,
    waiting: held.filter((job) => !job.blocked).length,
    blocked: held.filter((job) => job.blocked).length,
    doneToday: endedToday.filter((job) => job.status === "done").length,
    failedToday: endedToday.filter((job) => job.status !== "done").length,
    nightEnd: order.length ? Math.max(...order.map((one) => one.end)) : null,
  };
}

/** What the views show, from `readBacklog`'s state: pure. */
export function viewOf(state) {
  const { now, budget, jobs, archive, slots, journal = [], outputs = {}, traces = [], alivePids = [], machine = null } = state;
  const traceById = new Map(traces.filter((one) => one.id).map((one) => [one.id, one]));
  const running = jobs
    .filter((job) => job.status === "running")
    .map((job) => runningOf(job, { now, outputs, traceById, alivePids }))
    .sort((a, b) => b.elapsedMin - a.elapsedMin);
  const { order, waiting } = projectNight(jobs.filter((job) => !job.machine), archive, budget, now);
  const planned = order.filter(({ job }) => job.status !== "running").map(plannedOf);
  const held = [...waiting.map(heldOf), ...elsewhere(jobs).map(heldOf)];
  const finished = [...archive]
    .sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)))
    .slice(0, FINISHED_SHOWN)
    .map(finishedOf);
  const counts = countsOf({ now, archive, running, planned, held, order });
  return {
    now,
    machine: machine && { ...machine, budget },
    threads: { used: slots.reduce((sum, slot) => sum + slot.threads, 0), budget },
    runners: runnersOf({ slots, jobs, journal, alivePids }),
    running,
    planned,
    blocked: held.filter((job) => job.blocked),
    waiting: held.filter((job) => !job.blocked),
    finished,
    journal: [...journal].reverse(),
    traces: traces.map(traceOf(now)),
    counts,
    load: loadOf({ now, budget, running, planned, finished, archive, nightEnd: counts.nightEnd }),
  };
}

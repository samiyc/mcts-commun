import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * A day of the machine's queue replayed (Sami, 31/10/2026: "maximise the 18 threads, no more 10/18"): the real
 * timeline read from the journal (jobs and short tests, their threads and times), then the same jobs run again by a
 * policy, with the real durations and the real tests as fixed holds. `node bench/scheduler-replay.js [AAAA-MM-JJ] [--budget 18]`
 * prints, for the real day and for each policy, the makespan, the threads used, the idle threads while a job that fits
 * waited, and the waits of the priority-1 jobs. Reads `~/.mcts-backlog` (MCTS_BACKLOG_HOME), writes nothing.
 *
 * Policies: `current` (the next job by order starts if it fits; a gap is filled only when others' tests hold threads,
 * by a job of 15 min at most, node/fill.js), `easy` (a gap is filled whenever the next job does not fit, by a ready job
 * that fits and that either ends before the next job could start anyway or leaves it its threads then: EASY backfill),
 * `easy15` (the same, fillers of 15 min at most), `trim` (easy15, and the next job starts on the free threads when they
 * are at least two thirds of what it asks, as a job with `minThreads` would).
 */
const home = process.env.MCTS_BACKLOG_HOME ?? path.join(os.homedir(), ".mcts-backlog");
const args = process.argv.slice(2);
const day = args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg)) ?? new Date().toISOString().slice(0, 10);
const budget = args.includes("--budget") ? Number(args[args.indexOf("--budget") + 1]) : 18;
const MIN = 60_000;
const from = Date.parse(`${day}T00:00:00`);
const to = from + 24 * 60 * MIN;

function parsed(line) {
  try {
    return [JSON.parse(line)];
  } catch {
    return [];
  }
}
const journal = readFileSync(path.join(home, "journal", `${day.slice(0, 7)}.jsonl`), "utf8")
  .split("\n")
  .flatMap(parsed)
  .map((entry) => ({ ...entry, t: Date.parse(entry.at) }));
const archive = JSON.parse(readFileSync(path.join(home, "done", `${day.slice(0, 7)}.json`), "utf8"));
const byId = new Map(archive.map((job) => [job.id, job]));

/** The key an event opens or closes: a job's id, a slot's `slot:pid:id`, or null. */
function keyOf(entry) {
  if (entry.kind === "job-started" || entry.kind === "job-ended" || entry.kind === "job-preempted") return entry.id;
  if (entry.kind === "slot-started" || entry.kind === "slot-ended") return `slot:${entry.pid}:${entry.id}`;
  return null;
}

/** The runs of the day: each start with its end, `{ id, threads, start, end, kind, final }`, clipped to the day. */
function runsOf() {
  const open = new Map();
  const runs = [];
  for (const entry of journal) {
    const key = keyOf(entry);
    if (!key) continue;
    if (entry.kind.endsWith("-started")) open.set(key, entry);
    else if (open.has(key)) {
      const started = open.get(key);
      open.delete(key);
      runs.push({ id: entry.id, threads: started.threads, start: started.t, end: entry.t, kind: key.startsWith("slot:") ? "slot" : "job", final: entry.kind !== "job-preempted" });
    }
  }
  return runs.filter((run) => run.end > from && run.start < to).map((run) => ({ ...run, start: Math.max(run.start, from), end: Math.min(run.end, to) }));
}

/** The jobs the policies replay: the final run of each job of the day, with when it was added and what it waited for. */
function jobsOf(runs) {
  const added = new Map();
  for (const entry of journal) if (entry.kind === "added") for (const id of entry.ids) added.set(id, entry.t);
  const jobOf = (run) => {
    const job = byId.get(run.id) ?? {};
    return { id: run.id, threads: run.threads, minutes: (run.end - run.start) / MIN, added: Math.max(from, added.get(run.id) ?? run.start), priority: job.priority ?? 2, after: job.after ?? [], realStart: run.start };
  };
  return runs
    .filter((run) => run.kind === "job" && run.final)
    .map(jobOf)
    .sort((a, b) => a.realStart - b.realStart);
}

const threadsIn = (runs, t) => runs.filter((run) => run.start <= t && run.end > t).reduce((sum, run) => sum + run.threads, 0);

/** Thread-minutes used, idle thread-minutes while a ready job fitted, and the span, over the intervals `runs` and the waits. */
function measure(runs, waits, label) {
  const points = [...new Set(runs.flatMap((run) => [run.start, run.end]))].sort((a, b) => a - b);
  let used = 0;
  let idleWaiting = 0;
  let idleFit = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [t, next] = [points[i], points[i + 1]];
    const busy = threadsIn(runs, t);
    used += busy * (next - t);
    const waiting = waits.filter((wait) => wait.from <= t && wait.until > t);
    if (waiting.length) idleWaiting += Math.max(0, budget - busy) * (next - t);
    if (waiting.some((wait) => wait.threads <= budget - busy)) idleFit += Math.max(0, budget - busy) * (next - t);
  }
  const span = points.at(-1) - points[0];
  const hours = (ms) => Math.round(ms / MIN / 60);
  return { label, spanMin: Math.round(span / MIN), usedThreadH: hours(used), usedPct: Math.round((100 * used) / (budget * span)), idleWaitingThreadH: hours(idleWaiting), idleFitThreadH: hours(idleFit) };
}

/** When each real job became ready (added, its prerequisites started) and when it started. */
function realWaits(jobs) {
  const startOf = new Map(jobs.map((job) => [job.id, job.realStart]));
  return jobs.map((job) => ({ threads: job.threads, from: Math.max(job.added, ...job.after.map((id) => startOf.get(id) ?? 0)), until: job.realStart }));
}

/** The earliest time `threads` are free given the `running` ends, from `now`, `taken` threads held by tests. */
function earliest(running, now, threads, taken) {
  let free = budget - taken;
  if (free >= threads) return now;
  for (const run of [...running].sort((a, b) => a.end - b.end)) {
    free += run.threads;
    if (free >= threads) return run.end;
  }
  return Infinity;
}

/** The threads free at `at`: the budget less the tests' and those of the runs still going then. */
const freeAt = (running, at, taken) => budget - taken - running.filter((run) => run.end > at).reduce((sum, run) => sum + run.threads, 0);

/** `trim`: the next job on the threads free when they are at least two thirds of what it asks, its work the same; else null. */
function trimmed(head, free) {
  return free >= Math.ceil((2 * head.threads) / 3) ? { ...head, threads: free, minutes: (head.minutes * head.threads) / free } : null;
}

/** A filler under EASY backfilling: fits now, and ends before the next job could start or leaves it its threads then. */
function easyFiller(ready, head, { running, slotsNow, now, free, limit }) {
  const headStart = earliest(running, now, head.threads, slotsNow);
  const harmless = (job) => now + job.minutes * MIN <= headStart || job.threads <= freeAt(running, headStart, slotsNow) - head.threads;
  return ready.find((job) => job.id !== head.id && job.threads <= free && job.minutes <= limit && harmless(job)) ?? null;
}

/** node/fill.js before 31/10: a gap filled only when the next job would fit without the tests' threads, by a short job. */
function currentFiller(ready, head, { slotsNow, ours, free }) {
  if (slotsNow === 0 || ours + head.threads > budget) return null;
  return ready.find((job) => job.id !== head.id && job.threads <= free && job.minutes <= 15) ?? null;
}

/** Which ready job (`ready` in order, `head` first) a policy starts at `now`, or null. */
function pickBy(policy, { head, ready, running, slotsNow, now }) {
  const ours = running.reduce((sum, run) => sum + run.threads, 0);
  const free = budget - slotsNow - ours;
  if (head.threads <= free) return head;
  const settings = { running, slotsNow, now, free, ours };
  if (policy === "current") return currentFiller(ready, head, settings);
  if (policy === "trim") return trimmed(head, free) ?? easyFiller(ready, head, { ...settings, limit: 15 });
  return easyFiller(ready, head, { ...settings, limit: policy === "easy15" ? 15 : Infinity });
}

/** The state of a replay: the jobs pending, running, done, and the runs made. */
function stateOf(jobs, slots) {
  const state = { pending: jobs.map((job) => ({ ...job })), running: [], done: new Map(), runs: [], now: from, slots };
  state.slotsAt = (t) => threadsIn(slots, t);
  state.readyAt = (t) => state.pending.filter((job) => job.added <= t && job.after.every((id) => (state.done.get(id) ?? Infinity) <= t)).sort((a, b) => a.priority - b.priority || a.realStart - b.realStart);
  return state;
}

/** Starts `job` at `state.now`. */
function begin(state, job) {
  state.pending.splice(state.pending.findIndex((one) => one.id === job.id), 1);
  const run = { id: job.id, threads: job.threads, start: state.now, end: state.now + job.minutes * MIN, wait: state.now - job.added, priority: job.priority };
  state.running.push(run);
  state.runs.push(run);
}

/** The next moment something changes: a run ends, a job arrives, a test starts or ends; Infinity when nothing will. */
function nextMoment({ running, pending, slots, now }) {
  const times = [...running.map((run) => run.end), ...pending.map((job) => job.added), ...slots.flatMap((slot) => [slot.start, slot.end])];
  return Math.min(...times.filter((t) => t > now));
}

/** The runs ended by `state.now` leave `running`, done. */
function retire(state) {
  for (let i = state.running.length - 1; i >= 0; i -= 1) if (state.running[i].end <= state.now) state.done.set(state.running.splice(i, 1)[0].id, state.now);
}

/** What `policy` starts at `state.now`, or null. */
function pickNow(policy, state) {
  const ready = state.readyAt(state.now);
  return ready.length ? pickBy(policy, { head: ready[0], ready, running: state.running, slotsNow: state.slotsAt(state.now), now: state.now }) : null;
}

/** The day replayed under `policy`: the runs it makes, each with its wait. */
function replay(policy, jobs, slots) {
  const state = stateOf(jobs, slots);
  for (let guard = 0; state.pending.length && guard < 100_000; guard += 1) {
    retire(state);
    const pick = pickNow(policy, state);
    if (pick) {
      begin(state, pick);
      continue;
    }
    const next = nextMoment(state);
    if (!Number.isFinite(next)) break;
    state.now = next;
  }
  return state.runs;
}

const runs = runsOf();
const slots = runs.filter((run) => run.kind === "slot");
const jobs = jobsOf(runs);
const waitsOf = (list) => list.map((run) => ({ threads: run.threads, from: run.start - run.wait, until: run.start }));
function urgentText(list) {
  const ones = list.filter((run) => run.priority === 1);
  if (!ones.length) return "aucun";
  const mean = ones.reduce((sum, run) => sum + run.wait, 0) / ones.length / MIN;
  return `${Math.round(mean)} min en moyenne, ${Math.round(Math.max(...ones.map((run) => run.wait)) / MIN)} au plus (${ones.length} jobs)`;
}
console.log(`${day} : ${jobs.length} jobs, ${slots.length} tests courts, budget ${budget}`);
console.log(JSON.stringify(measure(runs, realWaits(jobs), "réel")));
for (const policy of ["current", "easy15", "easy", "trim"]) {
  const made = replay(policy, jobs, slots);
  console.log(JSON.stringify({ ...measure([...made, ...slots], waitsOf(made), policy), priorite1: urgentText(made), finis: made.length }));
}

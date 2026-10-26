/** A job that has ended, one way or another: it leaves the queue for the archive. */
export const FINISHED = Object.freeze(["done", "failed", "timeout", "skipped", "cancelled"]);
export const isFinished = (job) => FINISHED.includes(job.status);

/**
 * Which job of the queue runs next: lopin's src/schedule/order.js (Sami, 22/10/2026, validated 23/10 on real
 * jobs, lopin's docs/ismcts-ailleurs/backlog.md § 9.9), brought here unchanged for the machine-wide runner
 * (bin/backlog.js, Sami 23/10: the scheduler in common). Pure: the runner hands the queue, the archive and the
 * time.
 *
 * - `after`: ids of jobs that must be finished first, its prerequisites. One skipped by its `stopIf`
 *   counts as finished (the analysis runs on the duels played); one failed or timed out blocks the job.
 * - The jobs a `stopIf` names are prerequisites for the order only: the job waits for them whatever
 *   their end, then its `stopIf` decides. Without it, a short duel 2 could run before its duel 1.
 * - `priority`: 1 urgent, 2 normal (the default), 3 can wait. Among the ready jobs, Smith's rule: the
 *   most weight a minute first (weights 4, 2, 1; minutes read from `estimate`), file order between equals.
 * - `due`: when the result should be there (ISO, local time, like `notBefore`). A ready job that would
 *   miss it if the rule's pick ran first, and can still make it, goes first; the earliest `due` first.
 * With every priority at 2 and no `due`, the shortest estimate goes first.
 */
export const WEIGHTS = Object.freeze({ 1: 4, 2: 2, 3: 1 });
export const DEFAULT_MINUTES = 60;
const FINE_ENDS = new Set(["done", "skipped"]);

/** Minutes in an estimate as the queue writes them: "40 min", "1 h 30", "≤ 2 h", "1 à 2 h" (the most), "20 s". */
export function minutesOf(estimate) {
  /** @type {string[]} */
  const tokens = String(estimate ?? "").match(/\d+|\b(?:min|h|s)\b/g) ?? [];
  const before = (unit) => (tokens.indexOf(unit) > 0 ? Number(tokens[tokens.indexOf(unit) - 1]) : null);
  if (before("h") !== null) return before("h") * 60 + (Number(tokens[tokens.indexOf("h") + 1]) || 0);
  if (before("min") !== null) return before("min");
  return before("s") === null ? DEFAULT_MINUTES : before("s") / 60;
}

export const weightOf = (job) => WEIGHTS[job.priority ?? 2] ?? WEIGHTS[2];
const lengthOf = (job) => Math.max(minutesOf(job.estimate), 1 / 60);

/** Every job by id: the archive first (the latest entry of an id wins), then the queue over it. */
export function indexJobs(jobs, archive) {
  return new Map([...archive, ...jobs].map((job) => [job.id, job]));
}

/** Why an explicit prerequisite holds `job`, or null. */
function prerequisiteHold(job, byId) {
  for (const id of job.after ?? []) {
    const other = byId.get(id);
    if (!other) return { blocked: true, reason: `prérequis inconnu : ${id}` };
    if (!isFinished(other)) return { blocked: false, reason: `attend ${id}` };
    if (!FINE_ENDS.has(other.status)) return { blocked: true, reason: `${id} : ${other.status}` };
  }
  return null;
}

/** Why a job its `stopIf` reads holds `job` (order only), or null. */
function stopIfHold(job, byId) {
  const waiting = (job.stopIf ?? []).flatMap((condition) => condition.after).find((id) => byId.has(id) && !isFinished(byId.get(id)));
  return waiting ? { blocked: false, reason: `attend ${waiting} (stopIf)` } : null;
}

/**
 * What keeps `job` from starting at `now`, or null when it may start: `{ blocked, reason }`,
 * `blocked` when it never will without a hand edit (a failed or unknown prerequisite).
 */
export function holdOf(job, byId, now) {
  if (job.status === "scheduled" && now < Date.parse(job.notBefore)) return { blocked: false, reason: `pas avant ${job.notBefore}` };
  if (job.status !== "todo" && job.status !== "scheduled") return { blocked: true, reason: job.status };
  return prerequisiteHold(job, byId) ?? stopIfHold(job, byId);
}

/** The ready jobs in Smith's order: most weight a minute first, the file order between equals. */
export function smithOrder(ready) {
  return ready
    .map((job, index) => ({ job, index, rate: weightOf(job) / lengthOf(job) }))
    .sort((a, b) => b.rate - a.rate || a.index - b.index)
    .map(({ job }) => job);
}

/** Would `job` miss its `due` behind `first`, while it can still make it if it starts at `now`? */
function mustGoFirst(job, first, now) {
  if (!job.due || job === first) return false;
  const due = Date.parse(job.due);
  const end = now + lengthOf(job) * 60_000;
  return end <= due && end + lengthOf(first) * 60_000 > due;
}

/** The job to start at `now`, or undefined: see the module's comment. `fifo`: the file order instead. */
export function nextJob(jobs, archive, now, { fifo = false } = {}) {
  const byId = indexJobs(jobs, archive);
  const ready = jobs.filter((job) => !holdOf(job, byId, now));
  if (fifo || ready.length === 0) return ready[0];
  const [first] = smithOrder(ready);
  const pressed = ready.filter((job) => mustGoFirst(job, first, now)).sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  return pressed[0] ?? first;
}

/**
 * The night as the runner would play it if every job took its estimate and ended done: the order with
 * start and end times (`late` past its `due`), then what would still wait, and why. Like the runner, it
 * stops when nothing is ready (a `scheduled` job is not waited for).
 */
export function planNight(jobs, archive, now, options = {}) {
  const left = [...jobs];
  const finished = [...archive];
  const order = [];
  let clock = now;
  for (let job = nextJob(left, finished, clock, options); job; job = nextJob(left, finished, clock, options)) {
    const end = clock + lengthOf(job) * 60_000;
    order.push({ job, start: clock, end, late: Boolean(job.due) && end > Date.parse(job.due) });
    left.splice(left.indexOf(job), 1);
    finished.push({ ...job, status: "done" });
    clock = end;
  }
  const byId = indexJobs(left, finished);
  return { order, waiting: left.map((job) => ({ job, ...holdOf(job, byId, clock) })) };
}

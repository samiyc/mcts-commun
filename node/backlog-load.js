/**
 * How loaded the machine is (Sami, 26/10/2026: with three projects and more to come, the PC's 18 threads may no longer
 * be enough; measure before renting a server). Pure, from the view's jobs and the archive:
 * - the work the queue still asks, in hours of the whole machine (its estimates × threads, over the budget);
 * - when it would end against the morning (8:00);
 * - how far the estimates are from what the jobs took (a queue's end is only as good as they are);
 * - the last nights: how busy the machine was from 20:00 to 8:00, and how long past 8:00 their jobs ran.
 */
const MINUTE = 60_000;
export const NIGHT = { from: 20, to: 8 };
const NIGHTS_SHOWN = 7;
const RATIO_JOBS = 60;

/** The next 8:00 after `now`, local time. */
export function morningAfter(now) {
  const morning = new Date(now);
  morning.setHours(NIGHT.to, 0, 0, 0);
  if (morning.getTime() <= now) morning.setDate(morning.getDate() + 1);
  return morning.getTime();
}

/** Hours of the whole machine the queue still asks: what is left of the running jobs, then the planned ones. */
function queueHours(running, planned, budget) {
  const left = running.reduce((sum, job) => sum + Math.max(1, job.estimateMin - job.elapsedMin) * job.threads, 0);
  const coming = planned.reduce((sum, job) => sum + job.estimateMin * job.threads, 0);
  return (left + coming) / 60 / Math.max(1, budget);
}

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** What the last done jobs took against their estimate, the median ratio (0.3: three times quicker than said). */
function estimateRatio(finished) {
  const done = finished.filter((job) => job.status === "done" && job.minutes > 0 && job.estimateMin > 0).slice(0, RATIO_JOBS);
  return median(done.map((job) => job.minutes / job.estimateMin));
}

const span = (job) => {
  const start = Date.parse(job.startedAt);
  const end = Date.parse(job.doneAt);
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end: Math.max(end, start + Math.max(job.minutes ?? 0, 1) * MINUTE), threads: job.threads ?? 1 } : null;
};

/**
 * One night, from 20:00 the day `start` names to 8:00 the next (to `now` for the night under way): how busy the
 * machine was, how far past the morning the jobs begun that night ran.
 */
function nightOf(start, spans, { budget, now }) {
  const morning = morningAfter(start);
  const end = Math.min(morning, now);
  const inside = spans.filter((one) => one.start < end && one.end > start);
  const used = inside.reduce((sum, one) => sum + (Math.min(one.end, end) - Math.max(one.start, start)) * one.threads, 0);
  const begun = inside.filter((one) => one.start >= start);
  const lastEnd = Math.max(morning, ...begun.map((one) => one.end));
  return { start, jobs: begun.length, busy: used / (Math.max(MINUTE, end - start) * Math.max(1, budget)), pastMorningMin: Math.round((lastEnd - morning) / MINUTE), underWay: now < morning };
}

/** The last nights the archive and the jobs running saw, the most recent first, nights without a job left out. */
function nightsOf({ archive, running, budget, now }) {
  const busyNow = running.map((job) => ({ start: Date.parse(job.startedAt), end: now, threads: job.threads })).filter((one) => Number.isFinite(one.start));
  const spans = [...archive.map(span).filter(Boolean), ...busyNow];
  const evening = new Date(now);
  evening.setHours(NIGHT.from, 0, 0, 0);
  if (evening.getTime() > now) evening.setDate(evening.getDate() - 1);
  const nights = [];
  for (let back = 0; back < NIGHTS_SHOWN; back += 1) {
    const day = new Date(evening);
    day.setDate(day.getDate() - back);
    nights.push(nightOf(day.getTime(), spans, { budget, now }));
  }
  return nights.filter((night) => night.jobs > 0);
}

/**
 * The machine's load: `{ queueHours, givenHours, morning, pastMorningMin, estimateRatio, nights }`. `queueHours` at the
 * estimates learned from the archive (src/estimate.js, 27/10/2026: they replace the pace measured over every job),
 * `givenHours` at the ones the jobs were given, `estimateRatio` what the last jobs took against those.
 */
export function loadOf({ now, budget, running, planned, finished, archive, nightEnd }) {
  const morning = morningAfter(now);
  const given = (job) => ({ ...job, estimateMin: job.givenMin ?? job.estimateMin });
  const hours = queueHours(running, planned, budget);
  const ratio = estimateRatio(finished);
  return {
    queueHours: Math.round(hours * 10) / 10,
    givenHours: Math.round(queueHours(running.map(given), planned.map(given), budget) * 10) / 10,
    morning,
    pastMorningMin: nightEnd && nightEnd > morning ? Math.round((nightEnd - morning) / MINUTE) : 0,
    estimateRatio: ratio,
    nights: nightsOf({ archive, running, budget, now }),
  };
}

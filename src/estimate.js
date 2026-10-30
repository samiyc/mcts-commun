import { minutesOf } from "./schedule.js";

/**
 * A job's length learned from the archive (Sami, 27/10/2026: estimate the jobs from what the nights already ran).
 * The estimates the projects write were a factor 2.9 from what their jobs took (the median of the 292 jobs done to
 * 27/10, one in five a factor 5.5 or more); the same command's past runs, else its project's pace, guessed each job
 * from the jobs done before it started a factor 1.5 off (one in five 2.7; the night of 26/10, 1.4 and 2.0). An id's
 * family (its id but the date) found nothing the command did not. Pure: the runner orders the queue by it
 * (src/schedule.js reads `estimate`), the views plan the night with it.
 *
 * Among the jobs done in its folder (on the same machine):
 * - `command`: the same command, the median of what its last `RUNS` took;
 * - `project`: its estimate times the median of what the last `PACE_RUNS` took against theirs, `PACE_MIN` at least.
 *
 * A job `measured: true` keeps its own (cuisine, 28/10/2026: estimates measured anew after the day's speed-ups were
 * taken ×0.12, the pace of jobs whose estimates predated them; 108 min shown for some 45 of the whole machine).
 */
export const RUNS = 5;
const PACE_RUNS = 30;
export const PACE_MIN = 3;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const placeOf = (job) => `${job.machine ?? ""}|${job.cwd}`;
const lasting = (job) => job.status === "done" && job.minutes > 0;

/** The archive's done jobs by folder and machine, the most recent last. */
export function pastRuns(archive) {
  const byPlace = new Map();
  const done = archive.filter(lasting).sort((a, b) => String(a.doneAt).localeCompare(String(b.doneAt)));
  for (const job of done) {
    if (!byPlace.has(placeOf(job))) byPlace.set(placeOf(job), []);
    byPlace.get(placeOf(job)).push(job);
  }
  return byPlace;
}

/** What `job` should take, learned from `runs` (`pastRuns`): `{ minutes, basis, runs }`, or null with nothing to go by. */
export function learnedOf(job, runs) {
  if (job.measured) return null;
  const place = runs.get(placeOf(job)) ?? [];
  const same = place.filter((one) => one.command === job.command).slice(-RUNS);
  if (same.length) return { minutes: median(same.map((one) => one.minutes)), basis: "command", runs: same.length };
  const paced = place.filter((one) => minutesOf(one.estimate) > 0).slice(-PACE_RUNS);
  if (paced.length < PACE_MIN) return null;
  const pace = median(paced.map((one) => one.minutes / minutesOf(one.estimate)));
  return { minutes: minutesOf(job.given ?? job.estimate) * pace, basis: "project", runs: paced.length };
}

/** An estimate as the queue writes them, for `minutesOf`. */
const estimateText = (minutes) => (minutes >= 1 ? `${Math.round(minutes)} min` : `${Math.max(1, Math.round(minutes * 60))} s`);

/**
 * `jobs` with their learned estimate in `estimate`, the one they were given in `given`, how it was learned in
 * `learned` (`{ basis, runs }`); a job with nothing to learn from is left as it is.
 */
export function withLearned(jobs, archive) {
  const runs = pastRuns(archive);
  return jobs.map((job) => {
    const learned = learnedOf(job, runs);
    return learned ? { ...job, estimate: estimateText(learned.minutes), given: job.given ?? job.estimate, learned: { basis: learned.basis, runs: learned.runs } } : job;
  });
}

/**
 * A hill climb on a plan of numbers, allocating nothing once created (codingame, 28/10/2026: Mad Pod Racing v3 and
 * v4, a climb on the plan of two pods over 6 turns, from 1152nd to 60th-64th of 1841 in Legend; the library had
 * none). The loop of Mad Pod Racing's `evolve`, in the same order, so that a bot moved onto it plays the same orders:
 * - the first plan is the problem's (`start`: a plain race), then last run's best a turn later (`shift`), if any;
 * - then, until the deadline or the budget: every `freshEvery`-th plan a fresh one (`fresh`), else the best with a
 *   few genes moved (`mutate`), by an amplitude that shrinks from 1 to 0.1 as the time (or the budget) runs out;
 * - a plan scoring more than the best becomes the best (two buffers swapped, nothing copied).
 *
 * The result is one object, rewritten by each run; its `plan` is the climber's buffer: copy what you keep.
 *
 * The clock: `performance.now()` allocates its number, once in about 65 000 calls a collection (29/10/2026). Read
 * at every plan by default, as Mad Pod Racing does; `clockEvery: 8` reads it every 8 plans, the time between taken as
 * the last read. With a budget alone, never. Worth it only when scoring a plan costs next to nothing: twice the plans
 * at the bench, nothing for Mad Pod Racing, which simulates its plans (codingame, 29/10/2026).
 */

const clock = () => globalThis.performance.now();

/**
 * @typedef {object} ClimbProblem
 * @property {(plan: any) => void} start  writes the first plan
 * @property {(plan: any) => number} score  what a plan is worth, the more the better
 * @property {(child: any, best: any, amplitude: number, rng: any) => void} mutate  writes `best` moved into `child`
 * @property {(plan: any, rng: any) => void} fresh  writes a fresh plan
 * @property {(next: any, last: any, rng: any) => void} [shift]  writes last run's best plan a turn later into `next`
 */

/** `candidate` against the best: it becomes the best if it scores more (the buffers swapped). */
function consider(climb, problem) {
  const score = problem.score(climb.candidate);
  climb.result.evaluations += 1;
  if (score <= climb.result.score) return;
  const kept = climb.best;
  climb.best = climb.candidate;
  climb.candidate = kept;
  climb.result.score = score;
}

/** The share of the search left, 1 to 0.1: by the clock with a deadline, else by the budget. */
function amplitudeOf({ deadline, budget, begun, span, evaluations, now }) {
  const left = Number.isFinite(deadline) ? (deadline - now) / span : (budget - evaluations) / Math.max(1, budget - begun);
  return Math.max(0.1, left);
}

/** The first plans: the problem's, then last run's best shifted a turn. */
function begin(climb, problem, rng) {
  const { result } = climb;
  result.evaluations = 0;
  problem.start(climb.best);
  result.score = problem.score(climb.best);
  result.evaluations = 1;
  if (climb.hasLast && problem.shift) {
    problem.shift(climb.candidate, climb.last, rng);
    consider(climb, problem);
  }
}

/** The time now, read every `every` plans (the last read between them); 0 without a deadline. */
function timeOf(progress, every) {
  if (!progress.timed) return 0;
  progress.reads += 1;
  if (every === 1 || progress.reads % every === 0) progress.now = progress.clock();
  return progress.now;
}

/** The run's limits into `progress`: a deadline, a budget of plans scored, or both. */
function limit(progress, { deadline = Infinity, budget = Infinity, now = clock }) {
  if (!Number.isFinite(deadline) && !Number.isFinite(budget)) throw new Error("climb : une échéance (deadline) ou un budget");
  progress.deadline = deadline;
  progress.budget = budget;
  progress.timed = Number.isFinite(deadline);
  progress.clock = now;
  progress.reads = 0;
}

/** One plan more, then scored: a fresh one every `freshEvery`-th, else the best moved. */
function step(climb, problem, rng, freshEvery) {
  const { result, progress } = climb;
  if ((result.evaluations + 1) % freshEvery === 0) problem.fresh(climb.candidate, rng);
  else {
    progress.evaluations = result.evaluations;
    problem.mutate(climb.candidate, climb.best, amplitudeOf(progress), rng);
  }
  consider(climb, problem);
}

function runClimb(climb, problem, options) {
  const { rng, freshEvery = 10, clockEvery = 1 } = options;
  const { result, progress } = climb;
  limit(progress, options);
  begin(climb, problem, rng);
  progress.begun = result.evaluations;
  progress.span = Math.max(1, progress.deadline - timeOf(progress, 1));
  for (let at = timeOf(progress, 1); at < progress.deadline && result.evaluations < progress.budget; at = timeOf(progress, clockEvery)) step(climb, problem, rng, freshEvery);
  climb.last.set(climb.best);
  climb.hasLast = true;
  result.plan = climb.best;
  return result;
}

/**
 * A climber of plans of `genes` numbers (`Type`, Float64Array by default). Its `run(problem, { deadline, budget,
 * rng, freshEvery, clockEvery, now })` climbs a turn (`now`: performance.now by default; a deadline, a budget of plans scored,
 * or both) and returns `{ plan, score, evaluations }`. The same object each run, its plan the climber's own buffer.
 * `forget()` drops last run's best (a new game). One climber a search: a bot that also climbs for its opponent
 * makes two.
 *
 * @param {{ genes: number, Type?: Float64ArrayConstructor | Float32ArrayConstructor | Int16ArrayConstructor | Int32ArrayConstructor }} shape
 */
export function createClimb({ genes, Type = Float64Array }) {
  const climb = {
    best: new Type(genes),
    candidate: new Type(genes),
    last: new Type(genes),
    hasLast: false,
    progress: { deadline: Infinity, budget: Infinity, begun: 0, span: 1, evaluations: 0, now: 0.5, reads: 0, timed: false, clock },
    result: { plan: /** @type {any} */ (null), score: -Infinity, evaluations: 0 },
  };
  return {
    genes,
    /** @param {ClimbProblem} problem @param {{ deadline?: number, budget?: number, rng: any, freshEvery?: number, clockEvery?: number, now?: () => number }} options */
    run: (problem, options) => runClimb(climb, problem, options),
    forget() {
      climb.hasLast = false;
    },
  };
}

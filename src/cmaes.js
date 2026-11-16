import { createRng } from "./random.js";
import { settingsOf } from "./cmaes/settings.js";
import { decompose, draw, recombine, updateCovariance, updatePaths, updateSigma } from "./cmaes/update.js";
import { record, stopOf } from "./cmaes/stop.js";

/**
 * CMA-ES, the evolution strategy with covariance matrix adaptation (Hansen; Sami, 12/11/2026: « tout ce qui peut aider
 * » raquette et tryangle-catch). An escalade that learns: each generation draws a population of plans around a mean,
 * keeps the better half, and learns from them which way to move, how far, and which genes to move together. Where
 * `climb` moves one gene at random and gropes along a slanted valley, CMA-ES learns the valley's direction.
 *
 * Two ways to use it:
 * - `run(score, { budget, deadline })` when scoring a plan is a function call: a tuning, a plan in a turn;
 * - `ask()` then `tell(scores)` when each plan is scored elsewhere, a batch of games in the queue for each: `snapshot()`
 *   keeps the whole state as JSON between two processes, `createCmaes({ from })` takes it back.
 *
 * The score is the more the better, as `climb`'s. Settings are Hansen's (src/cmaes/settings.js): `sigma`, the first
 * step, about a third of each gene's range; genes of very different scales are best rescaled first (a gene in [0, 1]).
 * The plans `ask` returns are the strategy's own buffers, rewritten by the next `ask`: copy what you keep.
 *
 * IPOP (Auger and Hansen, 2005; raquette and codingame asked, Sami, 16/11/2026): when a descent has nothing left to
 * give (`stopped`, src/cmaes/stop.js), start again from the first mean and step with a population twice as large,
 * which searches wider and goes further; the best plan is kept across. `run(score, { restarts })` does it by itself;
 * with `ask`/`tell`, read `stopped` after each `tell` and call `restart()`.
 */

const identity = (n) => {
  const m = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) m[i * n + i] = 1;
  return m;
};
const plans = (count, n) => Array.from({ length: count }, () => new Float64Array(n));

/** What a snapshot holds, for a strategy that starts around `mean`. */
const freshOf = (n, mean = new Float64Array(n), sigma = 0.3) => ({ mean, sigma, C: identity(n), pc: new Float64Array(n), ps: new Float64Array(n), generation: 0, evaluations: 0, best: { plan: new Float64Array(n), score: -Infinity } });

/** A score from a snapshot: JSON writes -Infinity as null. */
const back = (score) => score ?? -Infinity;

/** What IPOP keeps of a strategy (src/cmaes/stop.js): the first mean and step, the restarts, the scores' history. */
const historyOf = (saved) => ({
  start: { mean: Float64Array.from(saved.start?.mean ?? saved.mean), sigma: saved.start?.sigma ?? saved.sigma },
  restarts: saved.restarts ?? 0,
  bests: Array.from(saved.bests ?? [], back),
  medians: Array.from(saved.medians ?? [], back),
  worst: back(saved.worst),
});

/** The strategy's state: a fresh one around `mean`, or one taken back from a snapshot (`from`). */
function stateOf(s, { mean, sigma, from }) {
  const n = s.n;
  const saved = from ?? freshOf(n, mean, sigma);
  const es = {
    ...historyOf(saved),
    scores: new Float64Array(s.lambda),
    s,
    n,
    mean: Float64Array.from(saved.mean),
    sigma: saved.sigma,
    C: Float64Array.from(saved.C),
    pc: Float64Array.from(saved.pc),
    ps: Float64Array.from(saved.ps),
    B: identity(n),
    D: new Float64Array(n).fill(1),
    invsqrtC: identity(n),
    values: new Float64Array(n),
    work: new Float64Array(n * n),
    z: new Float64Array(n),
    yw: new Float64Array(n),
    tmp: new Float64Array(n),
    xs: plans(s.lambda, n),
    ys: plans(s.lambda, n),
    order: new Int32Array(s.lambda),
    psLength: 0,
    generation: saved.generation,
    evaluations: saved.evaluations,
    sinceEigen: 0,
    best: { plan: Float64Array.from(saved.best.plan), score: back(saved.best.score) },
  };
  if (es.mean.length !== n) throw new Error(`cmaes : la moyenne a ${es.mean.length} gènes, pas ${n}`);
  if (from) decompose(es);
  return es;
}

/** The plans of the last ask ranked by `scores`, the best first, and the strategy moved one generation on. */
function tellOf(es, scores) {
  const { s, order, xs } = es;
  if (scores.length !== s.lambda) throw new Error(`cmaes : ${scores.length} scores pour ${s.lambda} plans`);
  const score = (k) => (Number.isNaN(scores[k]) ? -Infinity : scores[k]);
  for (let k = 0; k < s.lambda; k += 1) order[k] = k;
  order.sort((a, b) => score(b) - score(a) || a - b);
  if (score(order[0]) > es.best.score) {
    es.best.plan.set(xs[order[0]]);
    es.best.score = score(order[0]);
  }
  record(es, score);
  recombine(es);
  updateCovariance(es, updatePaths(es));
  updateSigma(es);
  es.generation += 1;
  es.evaluations += s.lambda;
  es.sinceEigen += 1;
  if (es.sinceEigen >= s.eigenEvery) {
    decompose(es);
    es.sinceEigen = 0;
  }
}

/** A new descent from the first mean and step, its population doubled; the best plan and the plans scored kept. */
function restartOf(es) {
  const next = stateOf(settingsOf(es.n, es.s.lambda * 2), { mean: es.start.mean, sigma: es.start.sigma, from: undefined });
  next.best.plan.set(es.best.plan);
  next.best.score = es.best.score;
  next.evaluations = es.evaluations;
  next.restarts = es.restarts + 1;
  return next;
}

/**
 * Generations until the budget of plans scored, the deadline, or a step under `minSigma`; with `restarts` (IPOP),
 * a descent that has nothing left to give starts again, up to `restarts` times in all. The best plan found.
 */
const LIMITS = { budget: Infinity, deadline: Infinity, now: () => globalThis.performance.now(), minSigma: 1e-12, restarts: 0 };

/** True when the descent is over: its step under `minSigma`, or, when restarts are asked, a sign of stop.js. */
function exhausted(box, { minSigma, restarts }) {
  const es = box.es;
  return es.sigma <= minSigma || (restarts > es.restarts && stopOf(es, box.stops) !== null);
}

/** One generation drawn, scored by `score` and told. */
function generation(box, score) {
  const es = box.es;
  const population = box.ask();
  for (let k = 0; k < population.length; k += 1) es.scores[k] = score(population[k]);
  tellOf(es, es.scores);
}

function runOf(box, score, limits) {
  const options = { ...LIMITS, ...limits };
  const { budget, deadline, now, restarts } = options;
  if (!Number.isFinite(budget) && !Number.isFinite(deadline)) throw new Error("cmaes : une échéance (deadline) ou un budget");
  while (box.es.evaluations + box.es.s.lambda <= budget && now() < deadline) {
    if (!exhausted(box, options)) generation(box, score);
    else if (box.es.restarts < restarts) box.es = restartOf(box.es);
    else break;
  }
  return box.es.best;
}

/** Everything to go on later, as plain JSON. */
const snapshotOf = (es, genes, rng) => ({
  genes,
  population: es.s.lambda,
  mean: [...es.mean],
  sigma: es.sigma,
  C: [...es.C],
  pc: [...es.pc],
  ps: [...es.ps],
  generation: es.generation,
  evaluations: es.evaluations,
  rng: rng.getState(),
  best: { plan: [...es.best.plan], score: es.best.score },
  start: { mean: [...es.start.mean], sigma: es.start.sigma },
  restarts: es.restarts,
  bests: [...es.bests],
  medians: [...es.medians],
  worst: es.worst,
});

/**
 * A strategy over plans of `genes` numbers, around `mean` (zeros by default) with a first step `sigma` (0.3).
 * `population` (4 + 3 ln genes by default) is the plans a generation; `seed` its draws. `from`: a snapshot to go on from.
 * `stops`: the thresholds of `stopped` (src/cmaes/stop.js, STOPS).
 * @param {{ genes: number, mean?: ArrayLike<number>, sigma?: number, population?: number, seed?: number, from?: any, stops?: object }} options
 */
export function createCmaes({ genes, mean, sigma, population, seed = 1, from, stops }) {
  const rng = createRng(seed);
  if (from) rng.setState(from.rng);
  const box = { es: stateOf(settingsOf(genes, from?.population ?? population), { mean, sigma, from }), stops, ask };
  function ask() {
    draw(box.es, rng);
    return box.es.xs;
  }
  return {
    genes,
    get population() {
      return box.es.s.lambda;
    },
    ask: box.ask,
    /** @param {ArrayLike<number>} scores one a plan of the last ask, in its order; NaN counts as the worst */
    tell: (scores) => tellOf(box.es, scores),
    /** @param {(plan: Float64Array) => number} score @param {{ budget?: number, deadline?: number, now?: () => number, minSigma?: number, restarts?: number }} limits */
    run: (score, limits) => runOf(box, score, limits),
    /** Why this descent should stop (IPOP's cue), or null. */
    get stopped() {
      return stopOf(box.es, stops);
    },
    /** Starts again from the first mean and step, the population doubled (IPOP); the plans of the last ask are void. */
    restart: () => {
      box.es = restartOf(box.es);
    },
    get restarts() {
      return box.es.restarts;
    },
    get best() {
      return box.es.best;
    },
    get mean() {
      return box.es.mean;
    },
    get sigma() {
      return box.es.sigma;
    },
    get evaluations() {
      return box.es.evaluations;
    },
    /** Everything to go on later (`createCmaes({ genes, from })`), as plain JSON. */
    snapshot: () => snapshotOf(box.es, genes, rng),
  };
}

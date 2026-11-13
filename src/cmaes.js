import { createRng } from "./random.js";
import { settingsOf } from "./cmaes/settings.js";
import { decompose, draw, recombine, updateCovariance, updatePaths, updateSigma } from "./cmaes/update.js";

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
 */

const identity = (n) => {
  const m = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) m[i * n + i] = 1;
  return m;
};
const plans = (count, n) => Array.from({ length: count }, () => new Float64Array(n));

/** What a snapshot holds, for a strategy that starts around `mean`. */
const freshOf = (n, mean = new Float64Array(n), sigma = 0.3) => ({ mean, sigma, C: identity(n), pc: new Float64Array(n), ps: new Float64Array(n), generation: 0, evaluations: 0, best: { plan: new Float64Array(n), score: -Infinity } });

/** The strategy's state: a fresh one around `mean`, or one taken back from a snapshot (`from`). */
function stateOf(s, { mean, sigma, from }) {
  const n = s.n;
  const saved = from ?? freshOf(n, mean, sigma);
  const es = {
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
    best: { plan: Float64Array.from(saved.best.plan), score: saved.best.score },
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

/** Generations until the budget of plans scored, the deadline, or a step under `minSigma`; the best plan found. */
const LIMITS = { budget: Infinity, deadline: Infinity, now: () => globalThis.performance.now(), minSigma: 1e-12 };

function runOf(es, ask, score, limits) {
  const { budget, deadline, now, minSigma } = { ...LIMITS, ...limits };
  if (!Number.isFinite(budget) && !Number.isFinite(deadline)) throw new Error("cmaes : une échéance (deadline) ou un budget");
  const scores = new Float64Array(es.s.lambda);
  while (es.evaluations + es.s.lambda <= budget && now() < deadline && es.sigma > minSigma) {
    const population = ask();
    for (let k = 0; k < population.length; k += 1) scores[k] = score(population[k]);
    tellOf(es, scores);
  }
  return es.best;
}

/**
 * A strategy over plans of `genes` numbers, around `mean` (zeros by default) with a first step `sigma` (0.3).
 * `population` (4 + 3 ln genes by default) is the plans a generation; `seed` its draws. `from`: a snapshot to go on from.
 * @param {{ genes: number, mean?: ArrayLike<number>, sigma?: number, population?: number, seed?: number, from?: any }} options
 */
export function createCmaes({ genes, mean, sigma, population, seed = 1, from }) {
  const es = stateOf(settingsOf(genes, from?.population ?? population), { mean, sigma, from });
  const rng = createRng(seed);
  if (from) rng.setState(from.rng);
  const ask = () => {
    draw(es, rng);
    return es.xs;
  };
  return {
    genes,
    population: es.s.lambda,
    ask,
    /** @param {ArrayLike<number>} scores one a plan of the last ask, in its order; NaN counts as the worst */
    tell: (scores) => tellOf(es, scores),
    /** @param {(plan: Float64Array) => number} score @param {{ budget?: number, deadline?: number, now?: () => number, minSigma?: number }} limits */
    run: (score, limits) => runOf(es, ask, score, limits),
    get best() {
      return es.best;
    },
    get mean() {
      return es.mean;
    },
    get sigma() {
      return es.sigma;
    },
    get evaluations() {
      return es.evaluations;
    },
    /** Everything to go on later (`createCmaes({ genes, from })`), as plain JSON. */
    snapshot: () => ({ genes, population: es.s.lambda, mean: [...es.mean], sigma: es.sigma, C: [...es.C], pc: [...es.pc], ps: [...es.ps], generation: es.generation, evaluations: es.evaluations, rng: rng.getState(), best: { plan: [...es.best.plan], score: es.best.score } }),
  };
}

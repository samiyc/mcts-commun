/**
 * When a descent of CMA-ES has nothing left to give, as Hansen's tutorial (2016, B.3) tells it: what makes IPOP
 * (Auger and Hansen, 2005) start again with a population twice as large. Four signs, the first found is the reason:
 * - "tolFun": the scores of the last generations all lie within `tolFun` of each other;
 * - "tolX": the step, along every gene, is under `tolX` times the first step;
 * - "condition": the covariance is so stretched (its largest eigenvalue over its smallest above 10¹⁴) that it is noise;
 * - "stagnation": over the recent history (20 % of the generations, at least 120 + 30n/λ, at most 20 000), neither
 *   the best nor the median score of a generation has got better: the median of the latest 30 % is no higher than
 *   that of the oldest 30 %. On a noisy score, the sign that comes first.
 */

export const STOPS = { tolFun: 1e-12, tolX: 1e-12, maxCondition: 1e14 };
const LONGEST = 20_000;

/** Keeps the generation's best and median scores, and its worst (`es.order` ranked, the best first). */
export function record(es, score) {
  const { lambda } = es.s;
  es.bests.push(score(es.order[0]));
  es.medians.push(score(es.order[Math.floor(lambda / 2)]));
  es.worst = score(es.order[lambda - 1]);
  if (es.bests.length > LONGEST) {
    es.bests.shift();
    es.medians.shift();
  }
}

/** The median of `values` from `from` to `to` (excluded); allocates: it runs once a generation. */
function median(values, from, to) {
  const sorted = values.slice(from, to).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** True when neither history has got better over its recent span. */
function stagnant(es) {
  const { n, lambda } = es.s;
  const g = es.bests.length;
  const span = Math.min(LONGEST, Math.max(Math.ceil(120 + (30 * n) / lambda), Math.ceil(0.2 * es.generation)));
  if (g < span) return false;
  const part = Math.ceil(0.3 * span);
  const better = (values) => median(values, g - part, g) > median(values, g - span, g - span + part);
  return !better(es.bests) && !better(es.medians);
}

/** True when the last generations' scores, and this generation's worst, all lie within `tolFun`. */
function flat(es, tolFun) {
  const span = 10 + Math.ceil((30 * es.s.n) / es.s.lambda);
  if (es.bests.length < span) return false;
  let high = es.worst;
  let low = es.worst;
  for (let i = es.bests.length - span; i < es.bests.length; i += 1) {
    high = Math.max(high, es.bests[i]);
    low = Math.min(low, es.bests[i]);
  }
  return high - low < tolFun;
}

/** True when σ times the spread of every gene, and of the path pc, is under `tolX` times the first step. */
function still(es, tolX) {
  const { n, C, pc, sigma } = es;
  const limit = tolX * es.start.sigma;
  for (let i = 0; i < n; i += 1) if (sigma * Math.max(Math.abs(pc[i]), Math.sqrt(C[i * n + i])) >= limit) return false;
  return true;
}

/** The covariance's condition number, from the last decomposition (D holds the square roots of its eigenvalues). */
function condition(D) {
  let high = 0;
  let low = Infinity;
  for (const d of D) {
    high = Math.max(high, d);
    low = Math.min(low, d);
  }
  return (high / low) ** 2;
}

/**
 * Why this descent should stop, or null while it still has something to give.
 * @param {any} es  src/cmaes.js's state
 * @param {Partial<typeof STOPS>} [stops]
 * @returns {"tolFun" | "tolX" | "condition" | "stagnation" | null}
 */
export function stopOf(es, stops) {
  const { tolFun, tolX, maxCondition } = { ...STOPS, ...stops };
  if (flat(es, tolFun)) return "tolFun";
  if (still(es, tolX)) return "tolX";
  if (condition(es.D) > maxCondition) return "condition";
  return stagnant(es) ? "stagnation" : null;
}

/**
 * Measures, as Lopin's duels taught them: a rate with its Wilson interval, and two rules compared by pairs
 * on the same scenarios, which removes the scenarios' own noise from the gap.
 */
const Z95 = 1.96;

/** A share of wins with its Wilson interval (95 % by default): `{ rate, low, high }`. */
export function wilson(wins, games, z = Z95) {
  if (games === 0) return { rate: 0, low: 0, high: 1 };
  const rate = wins / games;
  const z2 = z * z;
  const centre = (rate + z2 / (2 * games)) / (1 + z2 / games);
  const margin = (z / (1 + z2 / games)) * Math.sqrt((rate * (1 - rate)) / games + z2 / (4 * games * games));
  return { rate, low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

/**
 * Rule A against rule B, scenario by scenario (`scoresA[i]` and `scoresB[i]` on the same scenario): the mean
 * of the differences A − B with its 95 % interval, and the scenarios A won, tied and lost.
 * @returns {{ n: number, mean: number, low: number, high: number, wins: number, ties: number, losses: number }}
 */
export function paired(scoresA, scoresB, z = Z95) {
  if (scoresA.length !== scoresB.length) throw new Error(`paires inégales : ${scoresA.length} et ${scoresB.length}`);
  const gaps = scoresA.map((score, i) => score - scoresB[i]);
  const n = gaps.length;
  const mean = n ? gaps.reduce((sum, gap) => sum + gap, 0) / n : 0;
  const variance = n > 1 ? gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / (n - 1) : 0;
  const margin = n ? z * Math.sqrt(variance / n) : 0;
  return {
    n,
    mean,
    low: mean - margin,
    high: mean + margin,
    wins: gaps.filter((gap) => gap > 0).length,
    ties: gaps.filter((gap) => gap === 0).length,
    losses: gaps.filter((gap) => gap < 0).length,
  };
}

/** The expected score of a player `elo` points stronger, as chess engines count it: 0.5 at 0, about 0.514 at 10. */
export function eloScore(elo) {
  return 1 / (1 + 10 ** (-elo / 400));
}

/**
 * A sequential test (SPRT, as chess engines test a patch): after each game or scenario, whether the samples already
 * decide between h0 (no gain worth having) and h1 (the gain wanted), with the error rates alpha (h1 taken when h0 is
 * true) and beta (the other way); a series stops as soon as it is decided instead of playing all its games
 * (codingame, 30/10/2026: the 18 threads are the limit). A sample is a game's score (1 won, 0.5 drawn, 0 lost:
 * h0 = 0.5, h1 = eloScore(10)) or a gap A − B on a scenario (h0 = 0, h1 = the smallest gain worth having). The
 * log-likelihood ratio is the normal approximation of the generalized SPRT, with the samples' own variance; it
 * does not decide before `minSamples` (20: on 1 000 seeded series, 60 % against 50 %, it errs 4.5 and 5.2 % of
 * the time for 5 % asked, in 120 to 141 games where a fixed series plays about 270).
 * @param {number[]} samples
 * @param {{ h0: number, h1: number, alpha?: number, beta?: number, minSamples?: number }} hypotheses
 * @returns {{ n: number, mean: number, llr: number, lower: number, upper: number, verdict: "h0" | "h1" | "continue" }}
 */
export function sprt(samples, { h0, h1, alpha = 0.05, beta = 0.05, minSamples = 20 }) {
  if (h1 <= h0) throw new Error(`sprt : h1 (${h1}) doit dépasser h0 (${h0})`);
  const n = samples.length;
  const mean = n ? samples.reduce((sum, sample) => sum + sample, 0) / n : 0;
  const variance = n ? samples.reduce((sum, sample) => sum + (sample - mean) ** 2, 0) / n : 0;
  const llr = n < minSamples ? 0 : llrOf({ n, mean, variance }, h0, h1);
  const lower = Math.log(beta / (1 - alpha));
  const upper = Math.log((1 - beta) / alpha);
  return { n, mean, llr, lower, upper, verdict: verdictOf(llr, lower, upper) };
}

/** The log-likelihood ratio of h1 against h0 for `n` samples of this mean and variance; infinite without spread. */
function llrOf({ n, mean, variance }, h0, h1) {
  const drift = (h1 - h0) * (2 * mean - h0 - h1);
  if (variance === 0) return drift === 0 ? 0 : Math.sign(drift) * Infinity;
  return (n * drift) / (2 * variance);
}

function verdictOf(llr, lower, upper) {
  if (llr >= upper) return "h1";
  return llr <= lower ? "h0" : "continue";
}

// Acklam's rational approximation of the normal quantile, |error| < 1.2e-9 (Wichura's AS241 is finer; not needed).
const A = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
const B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
const C = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
const LOW = 0.02425;
const poly = (coefficients, x) => coefficients.reduce((sum, c) => sum * x + c, 0);

/**
 * The z such that a standard normal falls below it with probability `p` (0 < p < 1): 1.96 for 0.975, 2.326 for 0.99.
 * The races' threshold (src/race.js), when several variants are compared at once and alpha is shared among them.
 */
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new Error(`normalQuantile : p vaut entre 0 et 1, pas ${p}`);
  if (p < LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return poly(C, q) / (poly(D, q) * q + 1);
  }
  if (p > 1 - LOW) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (poly(A, r) * q) / (poly(B, r) * r + 1);
}

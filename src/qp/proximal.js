import { countOf, slackOf } from "./rows.js";

/**
 * The proximal rounds for a singular Q (an LP among them): x_{k+1} = argmin ½ xᵀQx + cᵀx + ½ ε |x − x_k|², each a
 * strictly convex QP warmed by the last round's active set, until x stops moving. Where the objective barely slopes
 * along the free directions (an edge of an LP almost level with the cost), a round moves x by slope / ε only, and
 * the rounds would crawl: when two rounds end on the same active set, the next centre jumps along their move as far
 * as the objective falls and the constraints allow, as a simplex step would. A move that nothing stops and that
 * keeps falling is an unbounded problem.
 *
 * @typedef {import("./dual.js").Workspace & { previous: Float64Array, step: Float64Array, trial: Float64Array,
 *   g: Float64Array, rounds: number }} Rounds
 */

/** A cheap signature of the active inequalities: their count and two sums of their numbers. */
function signatureOf(w) {
  let sum = 0;
  let squares = 0;
  for (let k = w.p; k < w.iq; k += 1) {
    sum += w.A[k];
    squares += w.A[k] * w.A[k];
  }
  return (w.iq - w.p) * 1e12 + sum * 1e6 + squares;
}

/** The longest step t ≥ 0 along w.step from x that keeps every inactive constraint; w.trial is x + step. */
function longestStep(w) {
  const count = countOf(w.rows);
  let longest = Infinity;
  for (let k = w.rows.me; k < count; k += 1) {
    if (w.active[k]) continue;
    const now = slackOf(w.rows, k, w.x);
    const rate = slackOf(w.rows, k, w.trial) - now;
    if (rate < 0 && Number.isFinite(now)) longest = Math.min(longest, Math.max(0, now) / -rate);
  }
  return longest;
}

/** The slope ∇f·Δ and the curvature ΔᵀQΔ of the objective along Δ = w.step, at x. */
function alongStep(w, Q, c) {
  const { n, x, step } = w;
  let slope = 0;
  let curve = 0;
  for (let i = 0; i < n; i += 1) {
    let qx = 0;
    let qd = 0;
    if (Q) {
      for (let j = 0; j < n; j += 1) {
        qx += Q[i * n + j] * x[j];
        qd += Q[i * n + j] * step[j];
      }
    }
    slope += (qx + c[i]) * step[i];
    curve += qd * step[i];
  }
  return { slope, curve };
}

/** Moves x along the last round's move, as far as the objective falls and the constraints allow. False if unbounded. */
function extrapolate(w, Q, c) {
  for (let i = 0; i < w.n; i += 1) {
    w.step[i] = w.x[i] - w.previous[i];
    w.trial[i] = w.x[i] + w.step[i];
  }
  const { slope, curve } = alongStep(w, Q, c);
  if (slope >= 0 || Number.isNaN(slope)) return true;
  let t = longestStep(w);
  if (curve > 0) t = Math.min(t, -slope / curve);
  if (t === Infinity) return false;
  for (let i = 0; i < w.n; i += 1) w.x[i] += t * w.step[i];
  return true;
}

/** The constraints active now become the warm list of the next round. */
function warmFromActive(w) {
  if (w.warm.length < w.n) w.warm = new Int32Array(w.n);
  for (let k = w.p; k < w.iq; k += 1) w.warm[k - w.p] = w.A[k];
  w.warmCount = w.iq - w.p;
}

/** How far x moved from the last centre, against x's size. */
function movedOf(w) {
  let moved = 0;
  let size = 0;
  for (let j = 0; j < w.n; j += 1) {
    moved = Math.max(moved, Math.abs(w.x[j] - w.previous[j]));
    size = Math.max(size, Math.abs(w.x[j]));
  }
  return moved / (1 + size);
}

/**
 * The rounds, `solveOnce(g)` solving one of them for the linear cost g.
 * @param {Rounds} w
 * @param {{ Q?: ArrayLike<number>, c: ArrayLike<number>, epsilon: number, maxRounds: number }} problem
 * @param {(g: Float64Array) => import("./dual.js").Outcome} solveOnce
 * @returns {import("./dual.js").Outcome | { status: "unbounded", culprit: number }}
 */
export function proximal(w, { Q, c, epsilon, maxRounds }, solveOnce) {
  w.previous.fill(0);
  let signature = NaN;
  for (let round = 1; round <= maxRounds; round += 1) {
    w.rounds = round;
    for (let j = 0; j < w.n; j += 1) w.g[j] = c[j] - epsilon * w.previous[j];
    const outcome = solveOnce(w.g);
    if (outcome.status !== "optimal" || movedOf(w) <= w.tolerance) return outcome;
    const now = signatureOf(w);
    if (now === signature && !extrapolate(w, Q, c)) return { status: "unbounded", culprit: -1 };
    signature = now;
    w.previous.set(w.x);
    warmFromActive(w);
  }
  return { status: "unconverged", culprit: -1 };
}

import { createRng } from "../../src/random.js";

/** The QPs the tests draw by seed (tests/lib/qp.test.js, tests/lib/qp-highs.test.js). */

/** Row `row` of the row-major A, times x. */
export const rowDot = (A, row, n, x) => x.reduce((sum, v, j) => sum + A[row * n + j] * v, 0);

/** Q = MᵀM for M of `rank` rows drawn by seed, plus ridge × I; undefined for an LP (rank and ridge 0). */
function gram(rng, n, rank, ridge) {
  if (rank === 0 && ridge === 0) return undefined;
  const M = Array.from({ length: rank * n }, () => rng.normal());
  const Q = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) for (let k = 0; k < rank; k += 1) Q[i * n + j] += M[k * n + i] * M[k * n + j];
    Q[i * n + i] += ridge;
  }
  return Q;
}

/**
 * A QP drawn by seed around a feasible point x0: Q = MᵀM (+ δI when strict), inequalities that x0 meets, some on their
 * edge, equalities through x0, and a box. `rank` below n makes Q singular; `rank` 0 makes it an LP.
 */
export function drawn(seed, { n, me = 0, ml = 0, rank = n, ridge = 0 }) {
  const rng = createRng(seed);
  const x0 = Array.from({ length: n }, () => rng.normal());
  const Q = gram(rng, n, rank, ridge);
  const rows = (count) => Float64Array.from({ length: count * n }, () => rng.normal());
  const eqA = rows(me);
  const leA = rows(ml);
  const eq = { A: eqA, b: Float64Array.from({ length: me }, (_, r) => rowDot(eqA, r, n, x0)) };
  const le = { A: leA, b: Float64Array.from({ length: ml }, (_, r) => rowDot(leA, r, n, x0) + (rng.next() < 0.3 ? 0 : rng.next())) };
  const c = Float64Array.from({ length: n }, () => 3 * rng.normal());
  const lower = Float64Array.from(x0, (v) => v - 1 - rng.next());
  const upper = Float64Array.from(x0, (v) => v + 1 + rng.next());
  return { c, Q, eq, le, lower, upper };
}


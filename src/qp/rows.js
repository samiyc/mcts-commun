/**
 * The constraints of a QP, numbered as one list: the equalities first (Aeq x = beq), then the inequalities
 * (Ale x ≤ ble), then the lower bounds (x ≥ lower), then the upper ones (x ≤ upper). Each is seen as the dual
 * method sees it (Goldfarb and Idnani): a normal n and a slack s, with s = nᵀx − n₀ ≥ 0 when it holds (= 0 for an
 * equality). A missing bound is infinite: its slack is infinite, it never binds. Nothing here allocates but
 * `placeOf`, which only the result uses: the dual loop calls the others for every constraint.
 *
 * @typedef {object} Rows
 * @property {number} n     the variables
 * @property {number} me    the equalities
 * @property {number} ml    the inequalities
 * @property {ArrayLike<number>} Aeq  me × n, row-major
 * @property {ArrayLike<number>} beq
 * @property {ArrayLike<number>} Ale  ml × n, row-major
 * @property {ArrayLike<number>} ble
 * @property {ArrayLike<number> | undefined} lower
 * @property {ArrayLike<number> | undefined} upper
 */

export const KINDS = /** @type {const} */ (["eq", "le", "lower", "upper"]);

/** Where each kind starts in the one list. */
const startsOf = (rows) => [0, rows.me, rows.me + rows.ml, rows.me + rows.ml + rows.n];

/** The kind of constraint k (an index of KINDS), and its index among its kind. */
export function placeOf(rows, k) {
  const starts = startsOf(rows);
  let kind = 3;
  while (k < starts[kind]) kind -= 1;
  return { kind: KINDS[kind], index: k - starts[kind] };
}

/** The number of the `index`-th constraint of `kind` ("eq", "le", "lower" or "upper"). */
export const numberOf = (rows, kind, index) => startsOf(rows)[KINDS.indexOf(kind)] + index;

/** All the constraints: equalities, inequalities and the 2n bound slots. */
export const countOf = (rows) => rows.me + rows.ml + 2 * rows.n;

function rowDot(A, row, n, x) {
  let sum = 0;
  const start = row * n;
  for (let j = 0; j < n; j += 1) sum += A[start + j] * x[j];
  return sum;
}

/** Constraint k's right-hand side: beq, ble, lower or upper; ±Infinity for a missing bound. */
export function sideOf(rows, k) {
  const { me, ml, n } = rows;
  if (k < me) return rows.beq[k];
  if (k < me + ml) return rows.ble[k - me];
  const j = k - me - ml;
  if (j < n) return rows.lower ? rows.lower[j] : -Infinity;
  return rows.upper ? rows.upper[j - n] : Infinity;
}

/** The slack of constraint k at x: ≥ 0 when it holds; for an equality, the signed residual Aeq x − beq. */
export function slackOf(rows, k, x) {
  const { me, ml, n } = rows;
  const side = sideOf(rows, k);
  if (k < me) return rowDot(rows.Aeq, k, n, x) - side;
  if (k < me + ml) return side - rowDot(rows.Ale, k - me, n, x);
  const j = k - me - ml;
  return j < n ? x[j] - side : side - x[j - n];
}

/** The size of constraint k's right-hand side, for a tolerance relative to it. */
export function scaleOf(rows, k) {
  const side = sideOf(rows, k);
  return 1 + (Number.isFinite(side) ? Math.abs(side) : 0);
}

/** The normal of constraint k into `normal`: the row for an equality, minus it for an inequality, ±e_j for a bound. */
export function normalInto(rows, k, normal) {
  const { me, ml, n } = rows;
  if (k >= me + ml) {
    const j = k - me - ml;
    normal.fill(0);
    if (j < n) normal[j] = 1;
    else normal[j - n] = -1;
    return;
  }
  const A = k < me ? rows.Aeq : rows.Ale;
  const row = k < me ? k : k - me;
  const sign = k < me ? 1 : -1;
  for (let j = 0; j < n; j += 1) normal[j] = sign * A[row * n + j];
}

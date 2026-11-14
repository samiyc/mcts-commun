/**
 * The active set of the dual method (Goldfarb and Idnani, 1983), kept as two factors: J (n × n), whose first `iq`
 * columns span the active normals and whose others span their complement in the metric of G, and R (upper
 * triangular, iq × iq) with Jᵀ N = [R; 0] for the matrix N of active normals. A constraint enters or leaves by plane
 * reflections (Givens), O(n²) each, as in QuadProg++ (Di Gaspero), which follows the paper. Nothing allocates.
 *
 * @typedef {object} Factors
 * @property {number} n
 * @property {Float64Array} J  n × n, row-major
 * @property {Float64Array} R  n × n, row-major, its upper iq × iq corner in use
 * @property {Float64Array} d  Jᵀ times the normal entering
 * @property {Float64Array} u  the multipliers of the active constraints, the entering one at iq
 * @property {Int32Array} A    the active constraints' numbers, the entering one at iq
 * @property {number} iq       the active constraints
 * @property {number} Rnorm    the largest diagonal of R so far, the scale of a dependent normal
 */

/** Below this share of R's scale, a new normal depends on the active ones. */
const DEPENDENT = 1e-14;

/**
 * Turns d[j] into d[j − 1] by a reflection of columns j − 1 and j of J, which keeps d = Jᵀ n.
 * @param {Factors} w
 * @param {number} j
 */
function foldDown(w, j) {
  const { n, d, J } = w;
  const h = Math.sqrt(d[j - 1] * d[j - 1] + d[j] * d[j]);
  if (h === 0) return;
  const flip = d[j - 1] < 0 ? -1 : 1;
  const cc = (flip * d[j - 1]) / h;
  const ss = (flip * d[j]) / h;
  d[j - 1] = flip * h;
  d[j] = 0;
  const xny = ss / (1 + cc);
  for (let k = 0; k < n; k += 1) {
    const t1 = J[k * n + j - 1];
    const t2 = J[k * n + j];
    const a = t1 * cc + t2 * ss;
    J[k * n + j - 1] = a;
    J[k * n + j] = xny * (t1 + a) - t2;
  }
}

/**
 * Adds the normal whose d = Jᵀ n is in `w.d` as active constraint iq: folds d[iq + 1..] into d[iq] and stores
 * d[0..iq] as R's new column. False when the normal depends on the active ones (R would be singular).
 * @param {Factors} w
 */
export function addConstraint(w) {
  const { n, d, R } = w;
  for (let j = n - 1; j > w.iq; j -= 1) foldDown(w, j);
  const column = w.iq;
  w.iq += 1;
  for (let i = 0; i < w.iq; i += 1) R[i * n + column] = d[i];
  const pivot = Math.abs(d[column]);
  if (pivot <= DEPENDENT * w.Rnorm) return false;
  w.Rnorm = Math.max(w.Rnorm, pivot);
  return true;
}

/**
 * Restores R's diagonal at column j after a column left: a reflection of R's rows j and j + 1, and of J's columns.
 * @param {Factors} w
 * @param {number} j
 */
function restore(w, j) {
  const { n, R, J } = w;
  const h = Math.sqrt(R[j * n + j] ** 2 + R[(j + 1) * n + j] ** 2);
  if (h === 0) return;
  const flip = R[j * n + j] < 0 ? -1 : 1;
  const cc = (flip * R[j * n + j]) / h;
  const ss = (flip * R[(j + 1) * n + j]) / h;
  R[j * n + j] = flip * h;
  R[(j + 1) * n + j] = 0;
  ROTATION[0] = cc;
  ROTATION[1] = ss;
  ROTATION[2] = ss / (1 + cc);
  for (let k = j + 1; k < w.iq; k += 1) reflect(R, j * n + k, (j + 1) * n + k);
  for (let k = 0; k < n; k += 1) reflect(J, k * n + j, k * n + j + 1);
}

/** The reflection in use: c, s and s / (1 + c), kept here so that a reflection allocates nothing. */
const ROTATION = new Float64Array(3);

/** The reflection [c s; s −c] of the pair (M[a], M[b]), in QuadProg++'s stable form. */
function reflect(M, a, b) {
  const t1 = M[a];
  const t2 = M[b];
  M[a] = t1 * ROTATION[0] + t2 * ROTATION[1];
  M[b] = ROTATION[2] * (t1 + M[a]) - t2;
}

/**
 * Drops active constraint number `l` (an inequality: the equalities, at 0..p − 1, never leave). The entering
 * constraint at iq moves down with the others.
 * @param {Factors & { p: number }} w
 * @param {number} l
 */
export function dropConstraint(w, l) {
  const { n, A, u, R } = w;
  let qq = w.p;
  while (A[qq] !== l) qq += 1;
  for (let i = qq; i < w.iq - 1; i += 1) {
    A[i] = A[i + 1];
    u[i] = u[i + 1];
    for (let j = 0; j < n; j += 1) R[j * n + i] = R[j * n + i + 1];
  }
  A[w.iq - 1] = A[w.iq];
  u[w.iq - 1] = u[w.iq];
  A[w.iq] = -1;
  u[w.iq] = 0;
  for (let j = 0; j < w.iq; j += 1) R[j * n + w.iq - 1] = 0;
  w.iq -= 1;
  for (let j = qq; j < w.iq; j += 1) restore(w, j);
}

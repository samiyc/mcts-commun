/**
 * The eigenvalues and eigenvectors of a symmetric matrix, by Jacobi's rotations (cyclic sweeps): what CMA-ES needs to
 * draw along its covariance (src/cmaes.js). Matrices are flat, row after row, in Float64Arrays of n × n. Fine for the
 * few tens of genes a tuning has; past a few hundred, a library would do better.
 */
const MAX_SWEEPS = 50;
const TOLERANCE = 1e-14;

/** The sum of the squares off the diagonal, and on it. */
function norms(a, n) {
  let off = 0;
  let diagonal = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) diagonal += a[i * n + i] ** 2;
      else off += a[i * n + j] ** 2;
    }
  }
  return { off, diagonal };
}

/** Columns `p` and `q` of `m` turned by the rotation (c, s). */
function turnColumns(m, n, { p, q, c, s }) {
  for (let k = 0; k < n; k += 1) {
    const kp = m[k * n + p];
    const kq = m[k * n + q];
    m[k * n + p] = c * kp - s * kq;
    m[k * n + q] = s * kp + c * kq;
  }
}

/** Rows `p` and `q` of `m` turned by the rotation (c, s). */
function turnRows(m, n, { p, q, c, s }) {
  for (let k = 0; k < n; k += 1) {
    const pk = m[p * n + k];
    const qk = m[q * n + k];
    m[p * n + k] = c * pk - s * qk;
    m[q * n + k] = s * pk + c * qk;
  }
}

/** The rotation that zeroes a[p][q], applied to `a` (both sides) and to the eigenvectors `v`. */
function rotate(a, v, n, { p, q }) {
  const apq = a[p * n + q];
  if (apq === 0) return;
  const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
  const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
  const c = 1 / Math.sqrt(t * t + 1);
  const turn = { p, q, c, s: t * c };
  turnColumns(a, n, turn);
  turnRows(a, n, turn);
  turnColumns(v, n, turn);
}

/**
 * The eigen decomposition of the symmetric `matrix` (n × n): `values[i]` its eigenvalues, column i of `vectors` the
 * eigenvector of `values[i]`, so that matrix = vectors · diag(values) · vectorsᵀ. `work` (n × n) is scratch.
 * @param {Float64Array} matrix
 * @param {number} n
 * @param {{ values: Float64Array, vectors: Float64Array, work?: Float64Array }} into
 */
export function symmetricEigen(matrix, n, { values, vectors, work = new Float64Array(n * n) }) {
  work.set(matrix);
  vectors.fill(0);
  for (let i = 0; i < n; i += 1) vectors[i * n + i] = 1;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep += 1) {
    const { off, diagonal } = norms(work, n);
    if (off <= TOLERANCE * TOLERANCE * Math.max(diagonal, Number.MIN_VALUE)) break;
    for (let p = 0; p < n - 1; p += 1) for (let q = p + 1; q < n; q += 1) rotate(work, vectors, n, { p, q });
  }
  for (let i = 0; i < n; i += 1) values[i] = work[i * n + i];
}

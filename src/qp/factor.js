/**
 * The factor the dual method starts from (Goldfarb and Idnani, 1983): G = L Lᵀ by Cholesky, then J = L⁻ᵀ, so that
 * G⁻¹ = J Jᵀ. Matrices are Float64Array, n × n, row-major: M[i * n + j] is row i, column j.
 */

/**
 * The Cholesky factor of G + shift I into L (lower triangle; the upper one is left at zero). False when a pivot is
 * not positive, measured against the diagonal's scale: G + shift I is then not positive definite.
 * @param {ArrayLike<number> | undefined} G  undefined is the zero matrix (a linear objective)
 * @param {number} n
 * @param {number} shift
 * @param {Float64Array} L
 */
export function cholesky(G, n, shift, L) {
  L.fill(0);
  const floor = 1e-12 * Math.max(1, shift, maxDiagonal(G, n));
  for (let j = 0; j < n; j += 1) {
    const pivot = (G ? G[j * n + j] : 0) + shift - squaresBefore(L, n, j, j);
    if (pivot <= floor || Number.isNaN(pivot)) return false;
    const root = Math.sqrt(pivot);
    L[j * n + j] = root;
    for (let i = j + 1; i < n; i += 1) L[i * n + j] = ((G ? G[i * n + j] : 0) - squaresBefore(L, n, i, j)) / root;
  }
  return true;
}

/** Σ_{k<j} L[i][k] L[j][k], the part of G[i][j] the columns before j already explain. */
function squaresBefore(L, n, i, j) {
  let sum = 0;
  for (let k = 0; k < j; k += 1) sum += L[i * n + k] * L[j * n + k];
  return sum;
}

/** The largest diagonal entry of G, in absolute value; 0 for the zero matrix. */
export function maxDiagonal(G, n) {
  let max = 0;
  if (G) for (let i = 0; i < n; i += 1) max = Math.max(max, Math.abs(G[i * n + i]));
  return max;
}

/**
 * J = L⁻ᵀ, upper triangular: Lᵀ J = I solved column by column, from the bottom up.
 * @param {Float64Array} L
 * @param {number} n
 * @param {Float64Array} J
 */
export function inverseTranspose(L, n, J) {
  J.fill(0);
  for (let c = 0; c < n; c += 1) {
    for (let i = c; i >= 0; i -= 1) {
      let sum = i === c ? 1 : 0;
      for (let k = i + 1; k <= c; k += 1) sum -= L[k * n + i] * J[k * n + c];
      J[i * n + c] = sum / L[i * n + i];
    }
  }
}

/**
 * The unconstrained minimum x = −G⁻¹ g = −J (Jᵀ g), with `work` for Jᵀ g.
 * @param {Float64Array} J
 * @param {number} n
 * @param {Float64Array} g
 * @param {{ x: Float64Array, work: Float64Array }} into
 */
export function unconstrained(J, n, g, { x, work }) {
  work.fill(0);
  for (let j = 0; j < n; j += 1) {
    const v = g[j];
    if (v !== 0) for (let i = 0; i < n; i += 1) work[i] += J[j * n + i] * v;
  }
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    for (let k = i; k < n; k += 1) sum += J[i * n + k] * work[k];
    x[i] = -sum;
  }
}

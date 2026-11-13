import { symmetricEigen } from "./eigen.js";

/**
 * One generation of CMA-ES, step by step (Hansen's tutorial, 2016, § "The CMA-ES": sampling, selection and
 * recombination, step-size control, covariance matrix adaptation). `es` is src/cmaes.js's state: flat n × n matrices,
 * its buffers made once. Nothing here allocates.
 */

/** Fills `es.xs` with λ plans drawn around the mean: x = m + σ · B · (D ⊙ z), z standard normal; `es.ys` keeps B · (D ⊙ z). */
export function draw(es, rng) {
  const { n, B, D, z, mean, sigma } = es;
  for (let k = 0; k < es.xs.length; k += 1) {
    const x = es.xs[k];
    const y = es.ys[k];
    for (let i = 0; i < n; i += 1) z[i] = D[i] * rng.normal();
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      for (let j = 0; j < n; j += 1) sum += B[i * n + j] * z[j];
      y[i] = sum;
      x[i] = mean[i] + sigma * sum;
    }
  }
}

/** The new mean, from the μ best plans weighted (`es.order`, the best first); `es.yw` the step taken, in σ units. */
export function recombine(es) {
  const { n, s, yw, ys, order, mean, sigma } = es;
  yw.fill(0);
  for (let i = 0; i < s.mu; i += 1) {
    const y = ys[order[i]];
    for (let j = 0; j < n; j += 1) yw[j] += s.weights[i] * y[j];
  }
  for (let j = 0; j < n; j += 1) mean[j] += sigma * yw[j];
}

/** The two evolution paths; true while the step-size path is not too long (hσ, which stalls pc when σ grows fast). */
export function updatePaths(es) {
  const { n, s, ps, pc, yw, tmp, invsqrtC } = es;
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    for (let j = 0; j < n; j += 1) sum += invsqrtC[i * n + j] * yw[j];
    tmp[i] = sum;
  }
  const toS = Math.sqrt(s.cs * (2 - s.cs) * s.mueff);
  let length = 0;
  for (let i = 0; i < n; i += 1) {
    ps[i] = (1 - s.cs) * ps[i] + toS * tmp[i];
    length += ps[i] * ps[i];
  }
  es.psLength = Math.sqrt(length);
  const hsig = es.psLength / Math.sqrt(1 - (1 - s.cs) ** (2 * (es.generation + 1))) / s.chiN < 1.4 + 2 / (n + 1);
  const toC = hsig ? Math.sqrt(s.cc * (2 - s.cc) * s.mueff) : 0;
  for (let i = 0; i < n; i += 1) pc[i] = (1 - s.cc) * pc[i] + toC * yw[i];
  return hsig;
}

/** The covariance: its rank-one update by pc and its rank-μ update by the μ best steps, kept symmetric. */
export function updateCovariance(es, hsig) {
  const { n, s, C, pc, ys, order } = es;
  const keep = 1 - s.c1 - s.cmu + (hsig ? 0 : s.c1 * s.cc * (2 - s.cc));
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      let rankMu = 0;
      for (let k = 0; k < s.mu; k += 1) rankMu += s.weights[k] * ys[order[k]][i] * ys[order[k]][j];
      const value = keep * C[i * n + j] + s.c1 * pc[i] * pc[j] + s.cmu * rankMu;
      C[i * n + j] = value;
      C[j * n + i] = value;
    }
  }
}

/** σ grows when the path is longer than a random walk's, shrinks when shorter (cumulative step-size adaptation). */
export function updateSigma(es) {
  const { s } = es;
  es.sigma *= Math.exp(Math.min(1, (s.cs / s.ds) * (es.psLength / s.chiN - 1)));
}

/** B, D and C^−½ from C: C = B · diag(D²) · Bᵀ. */
export function decompose(es) {
  const { n, C, B, D, values, work, invsqrtC } = es;
  symmetricEigen(C, n, { values, vectors: B, work });
  for (let i = 0; i < n; i += 1) D[i] = Math.sqrt(Math.max(values[i], 1e-300));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      let sum = 0;
      for (let k = 0; k < n; k += 1) sum += (B[i * n + k] * B[j * n + k]) / D[k];
      invsqrtC[i * n + j] = sum;
    }
  }
}

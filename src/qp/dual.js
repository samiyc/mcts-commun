import { addConstraint, dropConstraint } from "./active.js";
import { countOf, normalInto, scaleOf, slackOf } from "./rows.js";

/**
 * The dual active-set method of Goldfarb and Idnani (1983), the loop of QuadProg++ (Di Gaspero). It starts from the
 * unconstrained minimum, puts the equalities in, then adds the most violated constraint one at a time, dropping an
 * active one whenever its multiplier would turn negative. Every step keeps the multipliers feasible and raises the
 * dual objective, so the loop ends: at the optimum when nothing is violated, or on a constraint that no step can
 * satisfy (the problem is infeasible). Nothing allocates inside it but the outcome.
 *
 * @typedef {import("./active.js").Factors & {
 *   rows: import("./rows.js").Rows,
 *   p: number,
 *   x: Float64Array, z: Float64Array, r: Float64Array, np: Float64Array,
 *   active: Uint8Array, warm: Int32Array, warmCount: number,
 *   leaving: number, tolerance: number, iterations: number, limit: number,
 * }} Workspace
 * @typedef {{ status: "optimal" | "infeasible" | "unconverged" | "numerical" | "cold", culprit: number }} Outcome
 */

/** Below this share of |Jᵀn|², the normal lies in the active normals' span: no primal step moves along it. */
const OUTSIDE = 1e-14;

/** d = Jᵀ n, skipping the normal's zeros (a bound's normal is one entry: O(n)). */
function computeD(w) {
  const { n, J, np, d } = w;
  d.fill(0);
  for (let j = 0; j < n; j += 1) {
    const v = np[j];
    if (v !== 0) for (let i = 0; i < n; i += 1) d[i] += J[j * n + i] * v;
  }
}

/** The primal direction z = J₂ d₂ (J's last n − iq columns) and the dual one r = R⁻¹ d₁. */
function directions(w) {
  const { n, J, R, d, z, r } = w;
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    for (let j = w.iq; j < n; j += 1) sum += J[i * n + j] * d[j];
    z[i] = sum;
  }
  for (let i = w.iq - 1; i >= 0; i -= 1) {
    let sum = 0;
    for (let j = i + 1; j < w.iq; j += 1) sum += R[i * n + j] * r[j];
    r[i] = (d[i] - sum) / R[i * n + i];
  }
}

/** Both directions for the normal in `w.np`; returns z·n, or 0 when no primal step moves along the normal. */
function prepare(w) {
  computeD(w);
  directions(w);
  let zn = 0;
  let dd = 0;
  for (let i = 0; i < w.n; i += 1) {
    zn += w.z[i] * w.np[i];
    dd += w.d[i] * w.d[i];
  }
  return zn > OUTSIDE * dd ? zn : 0;
}

/** The longest dual step before an active inequality's multiplier reaches 0; that constraint in `w.leaving`. */
function partialStep(w) {
  let t1 = Infinity;
  w.leaving = -1;
  for (let k = w.p; k < w.iq; k += 1) {
    if (w.r[k] > 0 && w.u[k] / w.r[k] < t1) {
      t1 = w.u[k] / w.r[k];
      w.leaving = w.A[k];
    }
  }
  return t1;
}

/** A step of length t: the multipliers along −r, the entering one up by t, and x along z if `primal`. */
function move(w, t, primal) {
  if (primal) for (let i = 0; i < w.n; i += 1) w.x[i] += t * w.z[i];
  for (let k = 0; k < w.iq; k += 1) w.u[k] -= t * w.r[k];
  w.u[w.iq] += t;
}

/** The equalities, all active from the start; a dependent one is skipped if consistent. The culprit, or −1. */
function addEqualities(w) {
  for (let k = 0; k < w.rows.me; k += 1) {
    normalInto(w.rows, k, w.np);
    const zn = prepare(w);
    const s = slackOf(w.rows, k, w.x);
    if (zn === 0) {
      if (Math.abs(s) > w.tolerance * scaleOf(w.rows, k)) return k;
      continue;
    }
    w.A[w.iq] = k;
    w.u[w.iq] = 0;
    move(w, -s / zn, true);
    if (!addConstraint(w)) return k;
    w.active[k] = 1;
  }
  w.p = w.iq;
  return -1;
}

/** The violation of constraint k at x, relative to its side; 0 when it holds within the tolerance or is active. */
function violationOf(w, k) {
  if (w.active[k] || k < w.rows.me) return 0;
  const s = slackOf(w.rows, k, w.x) / scaleOf(w.rows, k);
  return s < -w.tolerance ? s : 0;
}

/** The most violated constraint, the warm ones first (those active in the last solve); −1 when none is. */
function mostViolated(w) {
  let best = -1;
  let worst = 0;
  for (let i = 0; i < w.warmCount; i += 1) {
    const v = violationOf(w, w.warm[i]);
    if (v < worst) {
      best = w.warm[i];
      worst = v;
    }
  }
  if (best >= 0) return best;
  const count = countOf(w.rows);
  for (let k = w.rows.me; k < count; k += 1) {
    const v = violationOf(w, k);
    if (v < worst) {
      best = k;
      worst = v;
    }
  }
  return best;
}

/** Makes violated constraint ip active, dropping the active ones in its way. "ok", or why it cannot. */
function enforce(w, ip) {
  w.A[w.iq] = ip;
  w.u[w.iq] = 0;
  normalInto(w.rows, ip, w.np);
  for (;;) {
    w.iterations += 1;
    if (w.iterations > w.limit) return "unconverged";
    const step = stepTowards(w, slackOf(w.rows, ip, w.x));
    if (step === "infeasible") return step;
    if (step === "full") {
      if (!addConstraint(w)) return "numerical";
      w.active[ip] = 1;
      return "ok";
    }
  }
}

/**
 * One step towards the entering constraint of slack s: the full one, which makes it hold, or a partial one, which
 * drops the active constraint whose multiplier reached 0 first. "infeasible" when neither exists.
 */
function stepTowards(w, s) {
  const zn = prepare(w);
  const t1 = partialStep(w);
  const t2 = zn > 0 ? Math.max(0, -s / zn) : Infinity;
  const t = Math.min(t1, t2);
  if (t === Infinity) return "infeasible";
  move(w, t, t2 !== Infinity);
  if (t >= t2) return "full";
  w.active[w.leaving] = 0;
  dropConstraint(w, w.leaving);
  return "partial";
}

/**
 * The warm start: the warm constraints put in as if they were equalities, which leaves x the minimum on their
 * intersection and u its multipliers. If those of the inequalities are not negative, that is a point the dual
 * method may start from (a dual-feasible active set), and a neighbouring problem then needs only its few changes.
 * False otherwise: the caller starts again cold.
 */
function pinWarm(w) {
  for (let i = 0; i < w.warmCount; i += 1) {
    const k = w.warm[i];
    if (w.active[k] || k < w.rows.me) continue;
    normalInto(w.rows, k, w.np);
    const zn = prepare(w);
    if (zn === 0) continue;
    w.iterations += 1;
    w.A[w.iq] = k;
    w.u[w.iq] = 0;
    move(w, -slackOf(w.rows, k, w.x) / zn, true);
    if (!addConstraint(w)) return false;
    w.active[k] = 1;
  }
  while (unpinOne(w));
  for (let k = w.p; k < w.iq; k += 1) w.u[k] = Math.max(0, w.u[k]);
  return true;
}

/**
 * Takes out the pinned inequality of most negative multiplier, by the exact reverse of its entry: with the factors
 * of the active set without it, x − u z is the minimum on the larger intersection, and u + u r its multipliers. False
 * when none is negative: the active set is then a start for the dual method.
 */
function unpinOne(w) {
  let worst = -1;
  let largest = 0;
  for (let k = w.p; k < w.iq; k += 1) {
    largest = Math.max(largest, Math.abs(w.u[k]));
    if (worst < 0 ? w.u[k] < 0 : w.u[k] < w.u[worst]) worst = k;
  }
  if (worst < 0 || w.u[worst] >= -1e-12 * (1 + largest)) return false;
  const l = w.A[worst];
  const ul = w.u[worst];
  w.iterations += 1;
  w.active[l] = 0;
  dropConstraint(w, l);
  normalInto(w.rows, l, w.np);
  prepare(w);
  move(w, -ul, true);
  w.u[w.iq] = 0;
  w.A[w.iq] = -1;
  return true;
}

/**
 * Solves from the unconstrained minimum already in `w.x`, with `w.J` fresh from the factor, within `w.limit` steps
 * in all (`w.iterations` counts them); with `warm`, from the
 * warm constraints first. Status "cold" when they do not give a start: reset x and J, and solve again without.
 * @param {Workspace} w
 * @param {boolean} warm
 * @returns {Outcome}
 */
export function solveDual(w, warm) {
  w.iq = 0;
  w.p = 0;
  w.Rnorm = 1;
  w.R.fill(0);
  w.u.fill(0);
  w.A.fill(-1);
  w.active.fill(0);
  const bad = addEqualities(w);
  if (bad >= 0) return { status: "infeasible", culprit: bad };
  if (warm && !pinWarm(w)) return { status: "cold", culprit: -1 };
  for (;;) {
    const ip = mostViolated(w);
    if (ip < 0) return { status: "optimal", culprit: -1 };
    const outcome = enforce(w, ip);
    if (outcome !== "ok") return { status: outcome, culprit: ip };
  }
}

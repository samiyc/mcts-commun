import { cholesky, inverseTranspose, maxDiagonal, unconstrained } from "./qp/factor.js";
import { solveDual } from "./qp/dual.js";
import { proximal } from "./qp/proximal.js";
import { countOf, numberOf, placeOf } from "./qp/rows.js";

/**
 * A convex quadratic programme (Sami, 13/11/2026: « ok pour le solveur dans la lib »; asked by reseau for the DC-OPF
 * and by circuit for the minimum-curvature line):
 *
 *   minimise ½ xᵀQx + cᵀx   subject to   Aeq x = beq,   Ale x ≤ ble,   lower ≤ x ≤ upper.
 *
 * The method is the dual active set of Goldfarb and Idnani (1983), dense: exact, with the multipliers, and fast when
 * few constraints bind among many (a grid's N-1 limits). Q must be positive semidefinite. When it is only
 * semidefinite (an LP: Q left out), the solver runs proximal rounds, each a strictly convex QP warmed by the last,
 * x_{k+1} = argmin ½ xᵀQx + cᵀx + ½ ε |x − x_k|², until x stops moving: the limit is the exact optimum, not a
 * perturbed one; a round that would crawl along a level edge jumps to its end instead (src/qp/proximal.js).
 *
 * `createQp(n)` keeps the buffers between solves of the same size: solving allocates the result and, if the
 * constraints outgrow the last solve's, their flags. `warm` (a previous result's `active`) tries the constraints that
 * bound last time first: a neighbouring problem then solves in a few steps.
 *
 * @typedef {object} QpProblem
 * @property {ArrayLike<number>} c              the linear cost, n
 * @property {ArrayLike<number>} [Q]            n × n, row-major, symmetric positive semidefinite; left out: 0
 * @property {{ A: ArrayLike<number>, b: ArrayLike<number> }} [eq]   A x = b, A row-major (b.length × n)
 * @property {{ A: ArrayLike<number>, b: ArrayLike<number> }} [le]   A x ≤ b
 * @property {ArrayLike<number>} [lower]        x ≥ lower (−Infinity: none)
 * @property {ArrayLike<number>} [upper]        x ≤ upper (Infinity: none)
 *
 * @typedef {{ le: number[], lower: number[], upper: number[] }} QpActive  the binding constraints, by kind
 *
 * @typedef {object} QpOptions
 * @property {QpActive} [warm]        the constraints to try first, a previous result's `active`
 * @property {number} [tolerance]     a constraint holds within tolerance × (1 + |its side|); default 1e-9
 * @property {number} [epsilon]       the proximal weight when Q is singular; default 1e-4 × max(1, max Qᵢᵢ, max |cᵢ|)
 * @property {number} [maxIterations] the dual steps of one round; default 100 + 10 × (n + rows)
 * @property {number} [maxRounds]     the proximal rounds; default 200
 *
 * @typedef {object} QpResult
 * @property {"optimal" | "infeasible" | "unbounded" | "unconverged" | "numerical"} status  unbounded: the objective
 *   falls without end (only a singular Q can); unconverged: the step or round limit; numerical: a normal the factors
 *   judged dependent mid-way
 * @property {Float64Array} x
 * @property {number} value             ½ xᵀQx + cᵀx
 * @property {{ eq: Float64Array, le: Float64Array, lower: Float64Array, upper: Float64Array }} multipliers  the
 *   Karush-Kuhn-Tucker ones: Qx + c + Aeqᵀ eq + Aleᵀ le − lower + upper = 0, with le, lower, upper ≥ 0. The optimal
 *   value moves by −eq[i] per unit of beq[i] (a grid's nodal price, for its balance row) and by −le[i] per unit of ble[i]
 * @property {QpActive} active
 * @property {number} iterations        the dual steps
 * @property {number} rounds            the proximal rounds (1 when Q is positive definite)
 * @property {{ kind: string, index: number } | null} culprit  for infeasible: the constraint no step could satisfy
 */

const NO_ROWS = { A: [], b: [] };

/** The constraints as the dual loop reads them, checked against n. */
function rowsOf(n, problem) {
  const eq = problem.eq ?? NO_ROWS;
  const le = problem.le ?? NO_ROWS;
  const sizes = [["c", problem.c, n], ["Q", problem.Q, n * n], ["eq.A", eq.A, eq.b.length * n], ["le.A", le.A, le.b.length * n], ["lower", problem.lower, n], ["upper", problem.upper, n]];
  for (const [name, values, size] of sizes) {
    if (values && values.length !== size) throw new Error(`qp : ${name} a ${values.length} valeurs, il en faut ${size}`);
  }
  return { n, me: eq.b.length, ml: le.b.length, Aeq: eq.A, beq: eq.b, Ale: le.A, ble: le.b, lower: problem.lower, upper: problem.upper };
}

/** The buffers of one size. */
function workspaceOf(n) {
  const vector = () => new Float64Array(n);
  const matrix = () => new Float64Array(n * n);
  return {
    n, L: matrix(), J0: matrix(), J: matrix(), R: matrix(),
    x: vector(), z: vector(), d: vector(), r: vector(), np: vector(), work: vector(), g: vector(), previous: vector(), step: vector(), trial: vector(),
    u: new Float64Array(n + 1), A: new Int32Array(n + 1),
    active: new Uint8Array(0), warm: new Int32Array(0), warmCount: 0,
    rows: rowsOf(n, { c: vector() }), rounds: 1, iq: 0, p: 0, Rnorm: 1, leaving: -1, tolerance: 1e-9, iterations: 0, maxIterations: 0, limit: 0,
  };
}

/** Sizes the flags to the constraints, and the warm list from `warm`, those that still exist. */
function prepare(w, rows, options) {
  const count = countOf(rows);
  if (w.active.length < count) w.active = new Uint8Array(count);
  const warm = options.warm ?? { le: [], lower: [], upper: [] };
  const numbers = ["le", "lower", "upper"].flatMap((kind) => (warm[kind] ?? []).map((i) => numberOf(rows, kind, i)));
  w.warm = Int32Array.from(numbers.filter((k) => k < count));
  w.warmCount = w.warm.length;
  w.rows = rows;
  w.tolerance = options.tolerance ?? 1e-9;
  w.iterations = 0;
  w.rounds = 1;
  w.maxIterations = options.maxIterations ?? 100 + 10 * (rows.n + rows.me + rows.ml);
}

/** One strictly convex solve with linear cost g, from the factor in J0. */
function solveOnce(w, g) {
  w.limit = w.iterations + w.maxIterations;
  w.J.set(w.J0);
  unconstrained(w.J, w.n, g, w);
  const warm = w.warmCount > 0;
  const outcome = solveDual(w, warm);
  if (outcome.status !== "cold" && !(warm && outcome.status === "infeasible")) return outcome;
  w.J.set(w.J0);
  unconstrained(w.J, w.n, g, w);
  return solveDual(w, false);
}

/** The objective at x. */
function valueOf(problem, n, x) {
  let value = 0;
  for (let i = 0; i < n; i += 1) {
    let qx = 0;
    if (problem.Q) for (let j = 0; j < n; j += 1) qx += problem.Q[i * n + j] * x[j];
    value += x[i] * (0.5 * qx + problem.c[i]);
  }
  return value;
}

/** The result: x, the multipliers and the active set read off the factors. */
function resultOf(w, problem, outcome) {
  const { rows, n } = w;
  const multipliers = { eq: new Float64Array(rows.me), le: new Float64Array(rows.ml), lower: new Float64Array(n), upper: new Float64Array(n) };
  const active = { le: [], lower: [], upper: [] };
  for (let k = 0; k < w.iq; k += 1) {
    const { kind, index } = placeOf(rows, w.A[k]);
    multipliers[kind][index] = kind === "eq" ? -w.u[k] : w.u[k];
    if (kind !== "eq") active[kind].push(index);
  }
  for (const list of Object.values(active)) list.sort((a, b) => a - b);
  const x = Float64Array.from(w.x);
  const culprit = outcome.culprit >= 0 && outcome.status === "infeasible" ? placeOf(rows, outcome.culprit) : null;
  return { status: outcome.status, x, value: valueOf(problem, n, x), multipliers, active, iterations: w.iterations, rounds: w.rounds, culprit };
}

/**
 * A solver for problems of n variables, its buffers kept from one solve to the next.
 * @param {number} n
 */
export function createQp(n) {
  const w = workspaceOf(n);
  return {
    n,
    /**
     * @param {QpProblem} problem
     * @param {QpOptions} [options]
     * @returns {QpResult}
     */
    solve(problem, options = {}) {
      const rows = rowsOf(n, problem);
      prepare(w, rows, options);
      if (cholesky(problem.Q, n, 0, w.L)) {
        inverseTranspose(w.L, n, w.J0);
        return resultOf(w, problem, solveOnce(w, problem.c));
      }
      const scale = Math.max(1, maxDiagonal(problem.Q, n), ...Array.from(problem.c, Math.abs));
      const epsilon = options.epsilon ?? 1e-4 * scale;
      if (!cholesky(problem.Q, n, epsilon, w.L)) throw new Error("qp : Q n'est pas semi-définie positive");
      inverseTranspose(w.L, n, w.J0);
      const rounds = { Q: problem.Q, c: problem.c, epsilon, maxRounds: options.maxRounds ?? 200 };
      return resultOf(w, problem, proximal(w, rounds, (g) => solveOnce(w, g)));
    },
  };
}

/**
 * One solve, with fresh buffers.
 * @param {QpProblem} problem
 * @param {QpOptions} [options]
 */
export const solveQp = (problem, options) => createQp(problem.c.length).solve(problem, options);

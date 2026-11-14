import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createQp, solveQp } from "../../src/qp.js";
import { createRng } from "../../src/random.js";

const close = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * (1 + Math.abs(expected)), `${actual} au lieu de ${expected}`);

const rowDot = (A, row, n, x) => x.reduce((sum, v, j) => sum + A[row * n + j] * v, 0);

/** The gradient of the Lagrangian at the result: Qx + c + Aeqᵀ eq + Aleᵀ le − lower + upper. */
function lagrangianGradient(problem, { x, multipliers: m }) {
  const n = problem.c.length;
  const gradient = Array.from(problem.c, (c, i) => c + m.upper[i] - m.lower[i]);
  const add = (A, weights) => weights.forEach((weight, r) => gradient.forEach((_, i) => (gradient[i] += A[r * n + i] * weight)));
  if (problem.Q) add(problem.Q, x);
  if (problem.eq) add(problem.eq.A, m.eq);
  if (problem.le) add(problem.le.A, m.le);
  return gradient;
}

/**
 * The Karush-Kuhn-Tucker conditions, which prove a convex QP's optimum: x feasible, the multipliers of the
 * inequalities non-negative and zero where the constraint is slack, and the gradient of the Lagrangian zero.
 */
function assertKkt(problem, result, tolerance = 1e-7) {
  const n = problem.c.length;
  const { x, multipliers: m } = result;
  const scale = 1 + Math.max(...Array.from(problem.c, Math.abs));
  for (const g of lagrangianGradient(problem, result)) assert.ok(Math.abs(g) <= tolerance * scale, `le gradient du lagrangien vaut ${g}`);
  const eq = problem.eq ?? { A: [], b: [] };
  const le = problem.le ?? { A: [], b: [] };
  eq.b.forEach((b, r) => close(rowDot(eq.A, r, n, x), b, tolerance));
  le.b.forEach((b, r) => assertSide(b - rowDot(le.A, r, n, x), m.le[r], tolerance));
  const lower = problem.lower ?? new Array(n).fill(-Infinity);
  const upper = problem.upper ?? new Array(n).fill(Infinity);
  for (let i = 0; i < n; i += 1) {
    assertSide(x[i] - lower[i], m.lower[i], tolerance);
    assertSide(upper[i] - x[i], m.upper[i], tolerance);
  }
}

/** One inequality: it holds, its multiplier is non-negative, and one of the two is zero. */
function assertSide(slack, multiplier, tolerance) {
  assert.ok(slack >= -tolerance, `une contrainte est violée de ${-slack}`);
  assert.ok(multiplier >= -tolerance, `un multiplicateur est négatif : ${multiplier}`);
  if (Number.isFinite(slack)) assert.ok(Math.abs(slack * multiplier) <= tolerance * (1 + Math.abs(multiplier)), `ni lâche ni nul : ${slack} × ${multiplier}`);
}

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
function drawn(seed, { n, me = 0, ml = 0, rank = n, ridge = 0 }) {
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

describe("the QP solver (src/qp.js, Goldfarb-Idnani; Sami 13/11/2026)", () => {
  it("finds the textbook optima, with their multipliers", () => {
    const half = solveQp({ Q: [1, 0, 0, 1], c: [-1, -1], le: { A: [1, 1], b: [1] } });
    assert.equal(half.status, "optimal");
    close(half.x[0], 0.5);
    close(half.x[1], 0.5);
    close(half.multipliers.le[0], 0.5);
    assert.deepEqual(half.active.le, [0]);

    const balance = solveQp({ Q: [2, 0, 0, 2], c: [0, 0], eq: { A: [1, 1], b: [2] } });
    close(balance.x[0], 1);
    close(balance.value, 2);
    close(-balance.multipliers.eq[0], 2, 1e-8); // ∂f*/∂b = b for f* = b²/2: the price of one more unit

    const capped = solveQp({ Q: [1], c: [-3], upper: [2] });
    close(capped.x[0], 2);
    close(capped.multipliers.upper[0], 1);
    assert.deepEqual(capped.active.upper, [0]);
  });

  it("solves a linear programme exactly, through proximal rounds (Q left out)", () => {
    // max x + y under x + 2y ≤ 4, 3x + y ≤ 6, x, y ≥ 0: the vertex (1.6, 1.2), prices 0.4 and 0.2.
    const problem = { c: [-1, -1], le: { A: [1, 2, 3, 1], b: [4, 6] }, lower: [0, 0] };
    const result = solveQp(problem);
    assert.equal(result.status, "optimal");
    close(result.x[0], 1.6);
    close(result.x[1], 1.2);
    close(result.value, -2.8);
    close(result.multipliers.le[0], 0.4);
    close(result.multipliers.le[1], 0.2);
    assertKkt(problem, result);
  });

  it("crosses a level edge in a few rounds, and says when a programme is unbounded", () => {
    // min −x − 1e-6 y on 0 ≤ x ≤ 1, 0 ≤ y ≤ 1000: the edge x = 1 slopes by 1e-6 only; rounds alone would crawl it.
    const level = { c: [-1, -1e-6], lower: [0, 0], upper: [1, 1000] };
    const result = solveQp(level);
    assert.equal(result.status, "optimal");
    close(result.x[1], 1000);
    assert.ok(result.rounds <= 6, `${result.rounds} rounds`);
    assertKkt(level, result);

    const open = solveQp({ c: [-1, 0], lower: [0, 0], le: { A: [0, 1], b: [1] } });
    assert.equal(open.status, "unbounded");
  });

  it("meets the optimality conditions on QPs drawn by seed: strict, singular and linear", () => {
    const shapes = [
      { n: 6, me: 1, ml: 8, ridge: 0.1 },
      { n: 12, me: 3, ml: 30, ridge: 0.01 },
      { n: 20, me: 0, ml: 60, rank: 5 },
      { n: 15, me: 2, ml: 40, rank: 0 },
      { n: 30, me: 4, ml: 10, rank: 30 },
    ];
    for (const [i, shape] of shapes.entries()) {
      for (let seed = 1; seed <= 6; seed += 1) {
        const problem = drawn(100 * i + seed, shape);
        const result = solveQp(problem);
        assert.equal(result.status, "optimal", `forme ${i}, graine ${seed}`);
        assertKkt(problem, result, 1e-6);
      }
    }
  });

  it("says which constraint cannot hold", () => {
    const apart = solveQp({ Q: [1], c: [0], lower: [2], upper: [1] });
    assert.equal(apart.status, "infeasible");
    assert.ok(["lower", "upper"].includes(apart.culprit?.kind));

    const twice = solveQp({ Q: [1, 0, 0, 1], c: [0, 0], eq: { A: [1, 1, 2, 2], b: [1, 3] } });
    assert.deepEqual([twice.status, twice.culprit], ["infeasible", { kind: "eq", index: 1 }]);

    const again = solveQp({ Q: [1, 0, 0, 1], c: [0, 0], eq: { A: [1, 1, 2, 2], b: [1, 2] } });
    assert.equal(again.status, "optimal", "une égalité répétée est ignorée, pas infaisable");
    close(again.x[0], 0.5);
  });

  it("restarts warm: a neighbouring problem, and constraints added along the way (a grid's N-1), give the cold answer", () => {
    const qp = createQp(20);
    const problem = drawn(7, { n: 20, me: 2, ml: 80, ridge: 0.05 });
    const first = qp.solve(problem);
    const nudged = { ...problem, c: problem.c.map((v, i) => v + 0.01 * Math.sin(i)) };
    const cold = qp.solve(nudged);
    const warm = qp.solve(nudged, { warm: first.active });
    assert.ok(warm.iterations < cold.iterations, `${warm.iterations} pas à chaud, ${cold.iterations} à froid`);
    for (let i = 0; i < 20; i += 1) close(warm.x[i], cold.x[i], 1e-7);

    const fewer = { ...problem, le: { A: problem.le.A.subarray(0, 40 * 20), b: problem.le.b.subarray(0, 40) } };
    const partial = qp.solve(fewer);
    const added = qp.solve(problem, { warm: partial.active });
    for (let i = 0; i < 20; i += 1) close(added.x[i], first.x[i], 1e-7);
  });

  it("refuses a Q that is not positive semidefinite, and sizes that do not match", () => {
    assert.throws(() => solveQp({ Q: [1, 0, 0, -1], c: [0, 0] }), /semi-définie/);
    assert.throws(() => solveQp({ Q: [1, 0, 0], c: [0, 0] }), /Q a 3 valeurs, il en faut 4/);
  });

  it("solves circuit's shape: a smooth line, a singular curvature, every gene boxed", () => {
    // A closed second difference (its constants are free: Q singular), a pull to one side, the track's width.
    const n = 120;
    const Q = new Float64Array(n * n);
    for (let i = 0; i < n; i += 1) {
      const around = [(i + n - 1) % n, i, (i + 1) % n];
      const weights = [1, -2, 1];
      for (const [a, wa] of around.map((k, t) => [k, weights[t]])) for (const [b, wb] of around.map((k, t) => [k, weights[t]])) Q[a * n + b] += wa * wb;
    }
    const c = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * i) / n) * 0.3);
    const problem = { Q, c, lower: new Float64Array(n).fill(-1), upper: new Float64Array(n).fill(1) };
    const result = solveQp(problem);
    assert.equal(result.status, "optimal");
    assertKkt(problem, result, 1e-6);
  });
});

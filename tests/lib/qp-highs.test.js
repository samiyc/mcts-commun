import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import loadHighs from "highs";
import { solveQp } from "../../src/qp.js";
import { drawn } from "../fixtures/qp.js";

/**
 * HiGHS (Huangfu and Hall; `highs`, its WebAssembly build, MIT, a development dependency only: Sami, 14/11/2026, on
 * reseau's question 9) as an outside oracle for `qp`: the same problems, written in CPLEX's LP format, must give the
 * same optimal value, the same x where it is unique (a strictly convex QP), and the same verdict when infeasible.
 */

const name = (j) => `x${j}`;
const signed = (value, text) => `${value < 0 ? "-" : "+"} ${Math.abs(value)} ${text}`;

/** A row of coefficients as an LP-format sum; "0 x0" for an empty one. */
function linear(values) {
  const terms = Array.from(values).flatMap((v, j) => (v === 0 ? [] : [signed(v, name(j))]));
  return terms.length > 0 ? terms.join(" ") : "0 x0";
}

/** ½ xᵀQx in LP format: [ Σ Qᵢᵢ xᵢ² + Σ_{i<j} 2 Qᵢⱼ xᵢ xⱼ ] / 2. */
function quadratic(Q, n) {
  if (!Q) return "";
  const pairs = Array.from({ length: n }, (_, i) => Array.from({ length: n - i }, (_, k) => [i, i + k])).flat();
  const product = (i, j) => (i === j ? `${name(i)} ^ 2` : `${name(i)} * ${name(j)}`);
  const terms = pairs.flatMap(([i, j]) => (Q[i * n + j] === 0 ? [] : [signed((i === j ? 1 : 2) * Q[i * n + j], product(i, j))]));
  return terms.length > 0 ? ` + [ ${terms.join(" ")} ] / 2` : "";
}

/** The bound line of x_j: LP format's default is x ≥ 0, so every variable says its own. */
function bound(lower, upper, j) {
  const lo = lower ? lower[j] : -Infinity;
  const hi = upper ? upper[j] : Infinity;
  if (Number.isFinite(lo) && Number.isFinite(hi)) return ` ${lo} <= ${name(j)} <= ${hi}`;
  if (Number.isFinite(lo)) return ` ${name(j)} >= ${lo}`;
  return Number.isFinite(hi) ? ` -inf <= ${name(j)} <= ${hi}` : ` ${name(j)} free`;
}

/** The problem in CPLEX's LP format. */
function lpText(problem) {
  const n = problem.c.length;
  const rowsOf = (rows, sign, prefix) =>
    Array.from(rows?.b ?? [], (b, r) => ` ${prefix}${r}: ${linear(rows.A.subarray(r * n, (r + 1) * n))} ${sign} ${b}`);
  const constraints = [...rowsOf(problem.eq, "=", "e"), ...rowsOf(problem.le, "<=", "l")];
  const bounds = Array.from({ length: n }, (_, j) => bound(problem.lower, problem.upper, j));
  return ["Minimize", ` obj: ${linear(problem.c)}${quadratic(problem.Q, n)}`, "Subject To", ...constraints, "Bounds", ...bounds, "End"].join("\n");
}

/** The same problem made infeasible: its first inequality, and the same row asking for one more than its side. */
function contradicted(problem) {
  const n = problem.c.length;
  const row = problem.le.A.subarray(0, n);
  const A = Float64Array.from([...problem.le.A, ...row.map((v) => -v)]);
  const b = Float64Array.from([...problem.le.b, -problem.le.b[0] - 1]);
  return { ...problem, le: { A, b } };
}

describe("the QP solver against HiGHS (tests/lib/qp-highs.test.js; Sami 14/11/2026)", () => {
  let highs;
  before(async () => {
    highs = await loadHighs();
  });
  const both = (problem) => [solveQp(problem), highs.solve(lpText(problem))];

  it("reads the textbook LP as HiGHS does: the vertex, the value, the duals (ours are HiGHS's, negated)", () => {
    const [ours, theirs] = both({ c: Float64Array.of(-1, -1), le: { A: Float64Array.of(1, 2, 3, 1), b: Float64Array.of(4, 6) }, lower: Float64Array.of(0, 0) });
    assert.equal(theirs.Status, "Optimal");
    assert.ok(Math.abs(ours.value - theirs.ObjectiveValue) < 1e-9);
    theirs.Rows.forEach((row, r) => assert.ok(Math.abs(ours.multipliers.le[r] + row.Dual) < 1e-9, `ligne ${r}`));
  });

  it("finds HiGHS's optimal value on LPs, singular QPs and strict QPs drawn by seed, and its x when it is unique", () => {
    const shapes = [
      { n: 15, me: 2, ml: 40, rank: 0 },
      { n: 30, me: 1, ml: 120, rank: 0 },
      { n: 20, me: 0, ml: 60, rank: 5 },
      { n: 12, me: 3, ml: 30, ridge: 0.05 },
    ];
    for (const [i, shape] of shapes.entries()) {
      for (let seed = 1; seed <= 10; seed += 1) {
        const problem = drawn(1000 + 100 * i + seed, shape);
        const [ours, theirs] = both(problem);
        const where = `forme ${i}, graine ${seed}`;
        assert.deepEqual([ours.status, theirs.Status], ["optimal", "Optimal"], where);
        assert.ok(Math.abs(ours.value - theirs.ObjectiveValue) <= 1e-6 * (1 + Math.abs(theirs.ObjectiveValue)), `${where} : ${ours.value} contre ${theirs.ObjectiveValue}`);
        if (shape.ridge) ours.x.forEach((v, j) => assert.ok(Math.abs(v - theirs.Columns[name(j)].Primal) <= 1e-5, `${where}, x${j}`));
      }
    }
  });

  it("says infeasible where HiGHS does", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const [ours, theirs] = both(contradicted(drawn(2000 + seed, { n: 10, me: 1, ml: 20, rank: seed % 2 === 0 ? 0 : 10 })));
      assert.equal(ours.status, "infeasible", `graine ${seed}`);
      assert.match(theirs.Status, /Infeasible/, `graine ${seed}`);
    }
  });
});

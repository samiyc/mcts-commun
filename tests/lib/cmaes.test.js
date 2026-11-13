import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCmaes } from "../../src/cmaes.js";
import { symmetricEigen } from "../../src/cmaes/eigen.js";
import { createClimb } from "../../src/climb.js";
import { createRng } from "../../src/random.js";

/** The reference landscapes of the CMA-ES literature, as scores (the more the better): minus the function. */
const sphere = (x) => -x.reduce((sum, v) => sum + v * v, 0);
function rosenbrock(x) {
  let sum = 0;
  for (let i = 0; i < x.length - 1; i += 1) sum += 100 * (x[i + 1] - x[i] ** 2) ** 2 + (1 - x[i]) ** 2;
  return -sum;
}

/** An orthonormal basis drawn by seed (Gram-Schmidt), to slant a landscape away from the axes. */
function rotation(n, seed) {
  const rng = createRng(seed);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    let v = Array.from({ length: n }, () => rng.normal());
    for (const u of rows) {
      const dot = v.reduce((sum, x, k) => sum + x * u[k], 0);
      v = v.map((x, k) => x - dot * u[k]);
    }
    const length = Math.hypot(...v);
    rows.push(v.map((x) => x / length));
  }
  return rows;
}

/** A valley a million times longer than wide, slanted: the case where moving one gene at a time gropes. */
function slantedEllipsoid(n, seed) {
  const r = rotation(n, seed);
  return (x) => -r.reduce((sum, row, i) => sum + 10 ** ((6 * i) / (n - 1)) * row.reduce((dot, w, j) => dot + w * x[j], 0) ** 2, 0);
}

describe("the eigen decomposition of a symmetric matrix (src/cmaes/eigen.js)", () => {
  it("gives back the matrix from its eigenvalues and eigenvectors", () => {
    const n = 6;
    const rng = createRng(4);
    const m = new Float64Array(n * n);
    for (let i = 0; i < n; i += 1) for (let j = i; j < n; j += 1) m[i * n + j] = m[j * n + i] = rng.normal();
    const values = new Float64Array(n);
    const vectors = new Float64Array(n * n);
    symmetricEigen(m, n, { values, vectors });
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        let back = 0;
        for (let k = 0; k < n; k += 1) back += vectors[i * n + k] * values[k] * vectors[j * n + k];
        assert.ok(Math.abs(back - m[i * n + j]) < 1e-10, `(${i}, ${j}) : ${back} pour ${m[i * n + j]}`);
      }
    }
  });
});

describe("CMA-ES (src/cmaes.js, Sami 12/11/2026)", () => {
  it("finds the bottom of a sphere, and of a slanted valley where the climb gropes", () => {
    const round = createCmaes({ genes: 10, mean: new Array(10).fill(3), sigma: 1, seed: 5 });
    assert.ok(round.run(sphere, { budget: 6000 }).score > -1e-10);
    const valley = slantedEllipsoid(10, 3);
    const es = createCmaes({ genes: 10, mean: new Array(10).fill(1), sigma: 0.5, seed: 5 });
    const learned = es.run(valley, { budget: 20_000 }).score;
    const climb = createClimb({ genes: 10 });
    const problem = {
      start: (plan) => plan.fill(1),
      score: valley,
      fresh: (plan, rng) => plan.forEach((_, i) => (plan[i] = 2 * rng.next())),
      mutate(child, best, amplitude, rng) {
        child.set(best);
        child[rng.int(10)] += amplitude * (2 * rng.next() - 1);
      },
    };
    const groped = climb.run(problem, { budget: 20_000, rng: createRng(5) }).score;
    assert.ok(learned > -1e-12, `CMA-ES : ${learned}`);
    assert.ok(groped < -1, `the climb, one gene at a time : ${groped}`);
  });

  it("follows Rosenbrock's bent valley to its end", () => {
    const es = createCmaes({ genes: 3, sigma: 0.5, seed: 2 });
    const { plan } = es.run(rosenbrock, { budget: 10_000 });
    assert.ok(plan.every((x) => Math.abs(x - 1) < 1e-4), `${[...plan]}`);
  });

  it("replays from its seed, and draws otherwise from another", () => {
    const run = (seed) => [...createCmaes({ genes: 4, mean: [1, 2, 3, 4], seed }).run(sphere, { budget: 200 }).plan];
    assert.deepEqual(run(9), run(9));
    assert.notDeepEqual(run(9), run(10));
  });

  it("asks and is told across two processes: a snapshot goes on as if never stopped", () => {
    const score = slantedEllipsoid(5, 1);
    const tellOnce = (es) => es.tell(es.ask().map((plan) => score(plan)));
    const first = createCmaes({ genes: 5, mean: [1, 1, 1, 1, 1], seed: 3 });
    for (let g = 0; g < 12; g += 1) tellOnce(first);
    const kept = JSON.parse(JSON.stringify(first.snapshot()));
    const again = createCmaes({ genes: 5, from: kept });
    for (let g = 0; g < 8; g += 1) {
      tellOnce(first);
      tellOnce(again);
    }
    assert.deepEqual([...again.mean], [...first.mean]);
    assert.equal(again.sigma, first.sigma);
    assert.equal(again.evaluations, first.evaluations);
  });

  it("takes NaN for the worst score, and refuses what it cannot run", () => {
    const es = createCmaes({ genes: 2, seed: 1 });
    const population = es.ask();
    es.tell(population.map((_, k) => (k === 0 ? Number.NaN : -k)));
    assert.equal(es.best.score, -1, "the second plan, NaN being the worst");
    assert.throws(() => es.tell([1, 2]), /scores pour/);
    assert.throws(() => es.run(sphere, {}), /budget/);
    assert.throws(() => createCmaes({ genes: 0 }), /genes/);
    assert.throws(() => createCmaes({ genes: 2, mean: [1, 2, 3] }), /3 gènes/);
    assert.equal(createCmaes({ genes: 10 }).population, 10, "4 + 3 ln 10");
  });
});

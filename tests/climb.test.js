import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClimb } from "../src/climb.js";
import { createStatePool, copyState } from "../src/pool.js";
import { createRng } from "../src/random.js";

/**
 * The climb (src/climb.js, codingame 28/10/2026: Mad Pod Racing's `evolve`, made common) and the pools it and the
 * beam stand on (src/pool.js). A plan of 12 genes climbs towards a target; checked against Mad Pod Racing's loop
 * written here as it is, on the same draws.
 */
const GENES = 12;
const target = Float64Array.from({ length: GENES }, (_, k) => Math.sin(k) * 10);

const problem = {
  start: (plan) => plan.fill(0),
  score: (plan) => -plan.reduce((sum, gene, k) => sum + (gene - target[k]) ** 2, 0),
  mutate(child, best, amplitude, rng) {
    child.set(best);
    for (let i = 0, n = 1 + rng.int(3); i < n; i += 1) child[rng.int(GENES)] += (rng.next() * 2 - 1) * amplitude * 5;
  },
  fresh(plan, rng) {
    for (let k = 0; k < GENES; k += 1) plan[k] = rng.next() * 20 - 10;
  },
  shift(next, last, rng) {
    next.set(last.subarray(2));
    next[GENES - 2] = rng.next();
    next[GENES - 1] = rng.next();
  },
};

/** Mad Pod Racing's `evolve` as it is, `budget` plans scored instead of a deadline. */
function evolve(previous, rng, budget) {
  let best = new Float64Array(GENES);
  problem.start(best);
  let bestScore = problem.score(best);
  let candidate = new Float64Array(GENES);
  const consider = () => {
    const score = problem.score(candidate);
    if (score <= bestScore) return;
    [best, candidate] = [candidate, best];
    bestScore = score;
  };
  if (previous) {
    problem.shift(candidate, previous, rng);
    consider();
  }
  for (let evaluations = previous ? 2 : 1; evaluations < budget; ) {
    evaluations += 1;
    if (evaluations % 10 === 0) problem.fresh(candidate, rng);
    else problem.mutate(candidate, best, Math.max(0.1, (budget - evaluations + 1) / (budget - (previous ? 2 : 1))), rng);
    consider();
  }
  return { plan: best, score: bestScore };
}

describe("the climb (src/climb.js, codingame 28/10)", () => {
  it("climbs as Mad Pod Racing's evolve does: the same plans, two turns running", () => {
    const climb = createClimb({ genes: GENES });
    const [ours, theirs] = [createRng(2017), createRng(2017)];
    let previous = null;
    for (let turn = 0; turn < 2; turn += 1) {
      const found = climb.run(problem, { budget: 400, rng: ours });
      const plain = evolve(previous, theirs, 400);
      assert.deepEqual([Array.from(found.plan), found.score, found.evaluations], [Array.from(plain.plan), plain.score, 400], `turn ${turn}`);
      previous = Float64Array.from(plain.plan);
    }
    assert.ok(climb.run(problem, { budget: 3000, rng: ours }).score > -1, "close to the target");
  });

  it("stops at the deadline, rewrites one result, and forgets last turn's plan when asked", () => {
    const climb = createClimb({ genes: GENES });
    let ticks = 0;
    const found = climb.run(problem, { deadline: 50, rng: createRng(1), now: () => (ticks += 1) });
    assert.ok(found.evaluations > 1 && found.evaluations < 60);
    climb.forget();
    let shifted = false;
    const again = climb.run({ ...problem, shift: () => (shifted = true) }, { budget: 5, rng: createRng(1) });
    assert.equal(again, found, "the same object");
    assert.equal(shifted, false);
    assert.throws(() => climb.run(problem, { rng: createRng(1) }), /échéance/);
  });
});

describe("the pools of states (src/pool.js)", () => {
  it("hands views of one buffer, the same ones after a clear", () => {
    const pool = createStatePool(3, 2, Int16Array);
    const [a, b] = [pool.take(), pool.take()];
    assert.equal(pool.take(), null, "full");
    copyState(b, Int16Array.of(1, -2, 3));
    assert.deepEqual(Array.from(pool.buffer), [0, 0, 0, 1, -2, 3]);
    pool.clear();
    assert.equal(pool.take(), a, "the same view again");
    assert.equal(a.buffer, b.buffer);
  });
});

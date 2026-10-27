import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { search } from "../src/mcts.js";
import { createRng } from "../src/random.js";
import { doors, loudLuck, nim, twoJobs } from "./fixtures/problems.js";

describe("the tree search over hidden information (src/mcts.js)", () => {
  it("finds Nim's winning move for whoever is to play, crediting each actor with its own score", () => {
    for (const [pile, take] of [
      [4, 1],
      [5, 2],
      [7, 1],
    ]) {
      const found = search({ pile, toMove: "A" }, nim, { budget: 3000, rng: createRng(pile), depth: 10 });
      assert.equal(found.move, take, `pile de ${pile}`);
      assert.ok(found.value > 0.8, `pile de ${pile} : ${found.value}`);
    }
  });

  it("averages over the worlds it draws: the likelier door, worth about its odds", () => {
    const found = search({}, doors, { budget: 2000, rng: createRng(3) });
    assert.equal(found.move, "A");
    assert.ok(Math.abs(found.value - 0.7) < 0.05, `${found.value}`);
    assert.deepEqual([...found.visits.keys()], ["A", "B"]);
  });

  it("spends exactly its budget at the root, and replays from the same seed", () => {
    const run = () => search({ pile: 9, toMove: "A" }, nim, { budget: 500, rng: createRng(8) });
    const first = run();
    assert.equal(first.stats.reduce((sum, one) => sum + one.visits, 0), 500);
    assert.deepEqual(run().stats, first.stats);
    assert.throws(() => search({ pile: 3, toMove: "A" }, nim, { budget: 0 }), /budget/);
  });

  it("stops at its deadline, budget then optional and a cap, and plays at least once", () => {
    const ticking = () => {
      let time = 0;
      return () => (time += 1);
    };
    const spent = (found) => found.stats.reduce((sum, one) => sum + one.visits, 0);
    const state = { pile: 9, toMove: "A" };
    assert.equal(spent(search(state, nim, { deadline: 100, now: ticking() })), 100);
    assert.equal(spent(search(state, nim, { budget: 30, deadline: 100, now: ticking() })), 30);
    assert.equal(spent(search(state, nim, { deadline: 0, now: ticking() })), 1);
    assert.deepEqual(
      search(state, nim, { deadline: 500, now: ticking(), rng: createRng(8) }).stats,
      search(state, nim, { budget: 500, rng: createRng(8) }).stats,
    );
    assert.ok(spent(search(state, nim, { deadline: performance.now() + 20 })) > 0);
    assert.throws(() => search(state, nim, { deadline: Number.NaN }), /budget/);
  });

  it("keeps to the shortlist and to its depth", () => {
    const wide = { ...nim, moves: (world) => [1, 2, 3, 4, 5].filter((take) => take <= world.pile), shortlist: (world, moves) => moves.slice(0, 2) };
    const found = search({ pile: 20, toMove: "A" }, wide, { budget: 300, depth: 1 });
    assert.deepEqual([...found.visits.keys()].sort(), ["1", "2"]);
    assert.equal(found.size, 3);
    assert.ok(search({ pile: 20, toMove: "A" }, wide, { budget: 300, depth: 4 }).size > 3);
  });

  it("orders two jobs of hidden length to keep the one due", () => {
    const longDue = search({ due: { id: "long", at: 75 }, ends: {} }, twoJobs, { budget: 400, rng: createRng(2) });
    assert.equal(longDue.move, "long");
    const shortDue = search({ due: { id: "short", at: 32 }, ends: {} }, twoJobs, { budget: 400, rng: createRng(2) });
    assert.equal(shortDue.move, "short");
  });

  it("judges the root's moves on common worlds when asked, so a small gap shows through a loud luck", () => {
    let right = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const found = search({}, loudLuck, { budget: 24, rng: createRng(seed), common: true });
      if (found.move === "A") right += 1;
      assert.equal(found.stats.reduce((sum, one) => sum + one.visits, 0), 24);
    }
    assert.equal(right, 20);
    let plain = 0;
    for (let seed = 1; seed <= 20; seed += 1) if (search({}, loudLuck, { budget: 24, rng: createRng(seed) }).move === "A") plain += 1;
    assert.ok(plain < 20, `sans mondes communs : ${plain} sur 20`);
  });

  it("refuses an incomplete problem, naming what is missing", () => {
    assert.throws(() => search({}, { ...doors, rollout: undefined, shortlist: 3 }, { budget: 5 }), /Problem incomplet : rollout, shortlist/);
  });

  it("returns no move when there is nothing to decide", () => {
    const found = search({ pile: 0, toMove: "A" }, nim, { budget: 10 });
    assert.equal(found.move, null);
    assert.equal(found.size, 1);
  });
});

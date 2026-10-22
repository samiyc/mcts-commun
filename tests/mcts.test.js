import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { search } from "../src/mcts.js";
import { createRng } from "../src/random.js";

/** Nim: take 1 or 2 from the pile, the one who takes the last wins. Nothing hidden; two actors. */
const nim = {
  sample: (state) => ({ ...state }),
  actor: (world) => world.toMove,
  moves: (world) => [1, 2].filter((take) => take <= world.pile),
  key: (take) => String(take),
  play: (world, take) => ({ pile: world.pile - take, toMove: world.toMove === "A" ? "B" : "A", last: world.toMove }),
  over: (world) => world.pile === 0,
  rollout(world, rng) {
    let end = world;
    while (!this.over(end)) end = this.play(end, Math.min(end.pile, 1 + rng.int(2)));
    return end;
  },
  score: (world, actor) => (world.last === actor ? 1 : 0),
};

/** Two doors, the prize behind A seven times in ten: the search only sees the worlds it draws. */
const doors = {
  sample: (state, rng) => ({ prize: rng.next() < 0.7 ? "A" : "B", opened: null }),
  actor: () => "me",
  moves: () => ["A", "B"],
  key: (door) => door,
  play: (world, door) => ({ ...world, opened: door }),
  over: (world) => world.opened !== null,
  rollout: (world) => world,
  score: (world) => (world.opened === world.prize ? 1 : 0),
};

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

  it("keeps to the shortlist and to its depth", () => {
    const wide = { ...nim, moves: (world) => [1, 2, 3, 4, 5].filter((take) => take <= world.pile), shortlist: (world, moves) => moves.slice(0, 2) };
    const found = search({ pile: 20, toMove: "A" }, wide, { budget: 300, depth: 1 });
    assert.deepEqual([...found.visits.keys()].sort(), ["1", "2"]);
    assert.equal(found.size, 3);
    assert.ok(search({ pile: 20, toMove: "A" }, wide, { budget: 300, depth: 4 }).size > 3);
  });

  it("returns no move when there is nothing to decide", () => {
    const found = search({ pile: 0, toMove: "A" }, nim, { budget: 10 });
    assert.equal(found.move, null);
    assert.equal(found.size, 1);
  });
});

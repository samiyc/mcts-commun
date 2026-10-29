import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBeam } from "../src/beam.js";
import { createRng } from "../src/random.js";

/**
 * The beam (src/beam.js, codingame 28/10/2026: Hypersonic v2's, made common). A small game: a walker on an 8×8
 * grid picks coins; a state is [x, y, turn, 8 bytes of coins taken]. Checked against a beam written plainly here
 * (objects, a Map, a full sort): the same first action and score on 200 seeds.
 */
const SIDE = 8;
const SIZE = 11;
const STEPS = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function gameOf(seed) {
  const rng = createRng(seed);
  const coins = Array.from({ length: SIDE * SIDE }, () => (rng.next() < 0.25 ? 1 + rng.int(9) : 0));
  const walls = Array.from({ length: SIDE * SIDE }, (_, cell) => coins[cell] === 0 && rng.next() < 0.15);
  const root = new Uint8Array(SIZE);
  root[0] = rng.int(SIDE);
  root[1] = rng.int(SIDE);
  walls[root[1] * SIDE + root[0]] = false;
  return { coins, walls, root };
}

const taken = (s, cell) => (s[3 + (cell >> 3)] >> (cell & 7)) & 1;

function hash(s) {
  let h = 2166136261;
  for (let k = 0; k < SIZE; k += 1) h = Math.imul(h ^ s[k], 16777619);
  return h;
}

/** The game as a beam problem: a step onto a wall or off the grid is no move. */
function problemOf({ coins, walls }) {
  return {
    play(parent, child, action) {
      const x = parent[0] + STEPS[action][0];
      const y = parent[1] + STEPS[action][1];
      if (x < 0 || y < 0 || x >= SIDE || y >= SIDE || walls[y * SIDE + x]) return NaN;
      const cell = y * SIDE + x;
      Object.assign(child, { 0: x, 1: y, 2: parent[2] + 1 });
      if (taken(child, cell) || coins[cell] === 0) return 0;
      child[3 + (cell >> 3)] |= 1 << (cell & 7);
      return coins[cell];
    },
    // A tie-free value: the coins left near the walker, and a sliver of the state's key.
    value(s) {
      let near = 0;
      for (let cell = 0; cell < SIDE * SIDE; cell += 1) if (coins[cell] && !taken(s, cell)) near += coins[cell] / (1 + Math.abs((cell % SIDE) - s[0]) + Math.abs(Math.floor(cell / SIDE) - s[1]));
      return 0.1 * near + (hash(s) >>> 0) * 1e-15;
    },
    hash,
  };
}

/** Node's child by action `a` into the layer's `seen`, by its key: the better stays, a tie keeps both firsts. */
function offer(seen, problem, { node, a, d, fade }) {
  const state = Uint8Array.from(node.state);
  const gain = problem.play(node.state, state, a, d);
  if (Number.isNaN(gain)) return;
  const reward = node.reward + gain * fade ** d;
  const child = { state, reward, score: reward + problem.value(state, d), firsts: d === 1 ? new Set([a]) : node.firsts };
  const old = seen.get(problem.hash(state));
  if (!old || child.score > old.score) seen.set(problem.hash(state), child);
  else if (child.score === old.score) old.firsts = new Set([...old.firsts, ...child.firsts]);
}

/**
 * The same beam, written plainly: what src/beam.js must find. A state reached by two paths of the same score is
 * a true tie: either first action is right, so a node keeps them all (`firsts`).
 */
function plainBeam(root, problem, { width, depth, fade }) {
  let beam = [{ state: root, reward: 0, score: 0, firsts: new Set([0]) }];
  let found = { firsts: new Set([-1]), score: 0, depth: 0 };
  for (let d = 1; d <= depth; d += 1) {
    const seen = new Map();
    for (const node of beam) for (let a = 0; a < STEPS.length; a += 1) offer(seen, problem, { node, a, d, fade });
    if (seen.size === 0) break;
    beam = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, width);
    found = { firsts: beam[0].firsts, score: beam[0].score, depth: d };
  }
  return found;
}

/**
 * A local beam written plainly, as Hypersonic v4's `pruneLocal` (codingame, 29/10/2026): the children of a layer
 * (in the order they are made, a state seen again in its first place) sorted by score with a stable sort, then at
 * most `perGroup` of a cell taken in turn.
 */
function plainLocalBeam(root, problem, { width, depth, fade, perGroup }) {
  let beam = [{ state: root, reward: 0, score: 0, firsts: new Set([0]) }];
  let found = { firsts: new Set([-1]), score: 0, depth: 0 };
  for (let d = 1; d <= depth; d += 1) {
    const seen = new Map();
    for (const node of beam) for (let a = 0; a < STEPS.length; a += 1) offer(seen, problem, { node, a, d, fade });
    if (seen.size === 0) break;
    const onCell = new Map();
    const fits = (node) => {
      const cell = problem.group(node.state);
      onCell.set(cell, (onCell.get(cell) ?? 0) + 1);
      return onCell.get(cell) <= perGroup;
    };
    beam = [...seen.values()].sort((a, b) => b.score - a.score).filter(fits).slice(0, width);
    const top = beam.reduce((best, node) => (node.score > best.score ? node : best));
    found = { firsts: top.firsts, score: top.score, depth: d };
  }
  return found;
}

/** The walker's cell, a local beam's group. */
const cellOf = (s) => s[1] * SIDE + s[0];

describe("the beam (src/beam.js, codingame 28/10)", () => {
  it("finds what a plain beam finds: the same score and depth, a first action of the best, on 200 seeds", () => {
    const beam = createBeam({ size: SIZE, width: 12, actions: STEPS.length });
    let ties = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const game = gameOf(seed);
      const found = beam.run(game.root, problemOf(game), { depth: 9, fade: 0.9 });
      const plain = plainBeam(game.root, problemOf(game), { width: 12, depth: 9, fade: 0.9 });
      assert.deepEqual([found.score, found.depth], [plain.score, plain.depth], `seed ${seed}`);
      assert.ok(plain.firsts.has(found.first), `seed ${seed}: ${found.first} not among ${[...plain.firsts]}`);
      if (plain.firsts.size > 1) ties += 1;
    }
    assert.ok(ties < 40, `${ties} ties: the check would say little`);
  });

  it("keeps a state reached twice once, the better in its place", () => {
    // Left then right, right then left, staying twice: one state, the walker where it started.
    const root = Uint8Array.of(4, 4);
    const gains = [0, 1, 2];
    const problem = { play: (parent, child, a) => ((child[0] = parent[0] + [0, -1, 1][a]), gains[a]), value: () => 0, hash: (s) => s[0] };
    const found = createBeam({ size: 2, width: 9, actions: 3 }).run(root, problem, { depth: 2 });
    // Layer 1: three states; layer 2: x of 2..6 once each (5 states), x = 4 the best of 0+0, 1+2 and 2+1.
    assert.equal(found.states, 3 + 5);
    assert.equal(found.score, 4, "two steps right: 2 + 2");
    assert.equal(found.first, 2);
  });

  it("drops a layer the deadline cuts short: the last full one decides", () => {
    const game = gameOf(7);
    const beam = createBeam({ size: SIZE, width: 12, actions: STEPS.length });
    const two = { ...beam.run(game.root, problemOf(game), { depth: 2 }) };
    // The clock passes the deadline once the third layer has begun: its first parent played, the rest cut.
    const problem = problemOf(game);
    let late = false;
    const play = (parent, child, action, depth) => ((late ||= depth === 3), problem.play(parent, child, action));
    const found = beam.run(game.root, { ...problem, play }, { depth: 9, deadline: 1, now: () => (late ? 2 : 0) });
    assert.deepEqual([found.first, found.score, found.depth], [two.first, two.score, 2]);
  });

  it("keeps a local beam as Hypersonic v4 does: the same as a plain one sorted and capped by cell, on 200 seeds", () => {
    const beam = createBeam({ size: SIZE, width: 12, actions: STEPS.length, groups: SIDE * SIDE });
    let capped = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const game = gameOf(seed);
      const problem = { ...problemOf(game), group: cellOf };
      const found = beam.run(game.root, problem, { depth: 9, fade: 0.9, perGroup: 1 });
      const plain = plainLocalBeam(game.root, problem, { width: 12, depth: 9, fade: 0.9, perGroup: 1 });
      assert.deepEqual([found.score, found.depth], [plain.score, plain.depth], `seed ${seed}`);
      assert.ok(plain.firsts.has(found.first), `seed ${seed}: ${found.first} not among ${[...plain.firsts]}`);
      if (found.score !== plainBeam(game.root, problemOf(game), { width: 12, depth: 9, fade: 0.9 }).score) capped += 1;
    }
    assert.ok(capped > 20, `the cap changed ${capped} searches only: the check would say little`);
  });

  it("puts at most perGroup states of a cell in each layer, and wants its groups at creation", () => {
    const game = gameOf(5);
    const problem = problemOf(game);
    const parents = new Map();
    const play = (parent, child, action, depth) => {
      const key = `${depth}:${cellOf(parent)}`;
      if (action === 0) parents.set(key, (parents.get(key) ?? 0) + 1);
      return problem.play(parent, child, action);
    };
    createBeam({ size: SIZE, width: 30, actions: STEPS.length, groups: SIDE * SIDE }).run(game.root, { ...problem, play, group: cellOf }, { depth: 8, perGroup: 3 });
    assert.ok(Math.max(...parents.values()) <= 3, "at most 3 parents a cell in a layer");
    assert.ok([...parents.values()].includes(3), "the cap was reached");
    assert.throws(() => createBeam({ size: SIZE, width: 4, actions: 5 }).run(game.root, { ...problem, group: cellOf }, { depth: 2 }), /groups/);
  });

  it("says -1 when no child lives, and rewrites one result object, allocating none", () => {
    const beam = createBeam({ size: 1, width: 4, actions: 2 });
    const dead = beam.run(Uint8Array.of(0), { play: () => NaN, value: () => 0 }, { depth: 5 });
    assert.deepEqual({ ...dead }, { first: -1, score: 0, depth: 0, states: 0 });
    const alive = beam.run(Uint8Array.of(0), { play: (_, child, a) => ((child[0] += a), a), value: () => 0 }, { depth: 3 });
    assert.equal(alive, dead, "the same object");
    assert.deepEqual([alive.first, alive.score, alive.depth], [1, 3, 3]);
  });
});

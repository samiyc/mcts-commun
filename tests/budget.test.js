import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PerformanceObserver } from "node:perf_hooks";
import { createBeam } from "../src/beam.js";
import { createClimb } from "../src/climb.js";
import { astar, createDistances, createReservations } from "../src/grid.js";
import { search } from "../src/mcts.js";
import { createStatePool } from "../src/pool.js";
import { createRng } from "../src/random.js";
import { resetTrace, traceSnapshot } from "../src/trace.js";
import { GENES, SIZE, climbing, coinGame, objectBeam, root } from "./fixtures/bench.js";
import { CORRIDOR, passable, warehouse } from "./fixtures/plans.js";
import { nim } from "./fixtures/problems.js";

/**
 * The library's work budgets (Sami, 31/10/2026: tests so that no slowness comes back with a feature). What a call may
 * explore and what a turn may allocate, counted rather than timed, so that the queue's load never fails them: the bench
 * (`npm run bench`, bench/beam-climb.js) says the time, these say the work, on the bench's own cases. A budget that
 * moves on purpose is updated here, in its own commit, with the bench's numbers and why.
 */

/** The counters of A* since the last reset: the calls, the nodes explored, the failures, the floor's ways taken. */
function astarWork() {
  const { calls, expanded, notFound = 0, givenUp = 0, direct = 0 } = traceSnapshot().counters.astar;
  return { calls, expanded, notFound, givenUp, direct };
}

/** The bench's warehouse: ten robots parked, then 3 000 paths planned around them, the floor's way first with `direct`. */
function warehouseWork(direct) {
  const plan = warehouse(40, 21);
  const rng = createRng(7);
  const open = plan.find(".");
  const table = createReservations();
  for (let unit = 0; unit < 10; unit += 1) {
    const found = astar(plan, open[rng.int(open.length)], open[rng.int(open.length)], { passable, reservations: table, unit, park: true, horizon: 80 });
    if (found) table.reserve(unit, found, { stay: true });
  }
  const options = { passable, reservations: table, unit: "u", park: true, horizon: 80, ...(direct ? { direct: createDistances(plan, passable) } : {}) };
  resetTrace();
  for (let i = 0; i < 3000; i += 1) astar(plan, open[rng.int(open.length)], open[rng.int(open.length)], { ...options, start: rng.int(5) });
  return astarWork();
}

/** The corridor's dead end, asked 3 000 times by a cook shut in. */
function deadEndWork() {
  const table = createReservations();
  table.reserve("p", [{ x: 3, y: 3, t: 0 }], { stay: true });
  resetTrace();
  for (let i = 0; i < 3000; i += 1) astar(CORRIDOR, { x: 1, y: 1 }, { x: 12, y: 2 }, { passable, reservations: table, unit: "c", start: i % 7, horizon: 55 });
  return astarWork();
}

/** 20 000 short legs on a small kitchen, three cells away at most: the cost a call carries whatever it explores. */
function shortWork() {
  const plan = warehouse(14, 9);
  const rng = createRng(3);
  const open = plan.find(".");
  const table = createReservations();
  resetTrace();
  for (let i = 0; i < 20_000; i += 1) {
    const from = open[rng.int(open.length)];
    const near = open.filter((cell) => Math.abs(cell.x - from.x) + Math.abs(cell.y - from.y) <= 3);
    astar(plan, from, near[rng.int(near.length)], { passable, reservations: table, unit: "c" });
  }
  return astarWork();
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Garbage enough to fill a good part of the young generation. */
function junk() {
  const heap = [];
  for (let i = 0; i < 50_000; i += 1) heap.push({ i, text: `x${i}` });
  return heap.length;
}

/**
 * The collections during `turns` turns of `turn()`: after 20 turns of warm-up, the young generation is emptied by a
 * collection (garbage until one is seen), so that the window counts the turns' own allocations; the observer's entries
 * come in after the work, hence the waits.
 */
async function collectionsOf(turn, turns) {
  const counts = { minor: 0, major: 0 };
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) counts[/** @type {any} */ (entry).detail?.kind === 1 ? "minor" : "major"] += 1;
  });
  observer.observe({ entryTypes: ["gc"] });
  for (let i = 0; i < 20; i += 1) turn();
  await settle(50);
  counts.minor = 0;
  for (let rounds = 0; rounds < 200 && counts.minor === 0; rounds += 1) {
    junk();
    await settle(5);
  }
  counts.minor = 0;
  counts.major = 0;
  for (let i = 0; i < turns; i += 1) turn();
  await settle(100);
  observer.disconnect();
  return { ...counts };
}

describe("the library's work budgets (tests/budget.test.js, 31/10/2026)", () => {
  it("A*: 116 nodes a call on the bench's warehouse, 83 with the floor's distances, 34 in the dead end, 3 on a short leg", () => {
    assert.deepEqual(warehouseWork(false), { calls: 3000, expanded: 348_340, notFound: 50, givenUp: 50, direct: 0 });
    assert.deepEqual(warehouseWork(true), { calls: 3000, expanded: 248_166, notFound: 50, givenUp: 50, direct: 1770 });
    assert.deepEqual(deadEndWork(), { calls: 3000, expanded: 102_000, notFound: 3000, givenUp: 3000, direct: 0 });
    assert.deepEqual(shortWork(), { calls: 20_000, expanded: 64_351, notFound: 0, givenUp: 0, direct: 0 });
  });

  it("search: one world drawn an iteration, at most depth plays, at most one rollout", () => {
    resetTrace();
    search({ pile: 9, toMove: "A" }, nim, { budget: 200, depth: 5, rng: createRng(5) });
    const { sample, play, rollout, search: searched } = traceSnapshot().counters;
    assert.equal(sample.calls, 200);
    assert.ok(play.calls >= 200 && play.calls <= 1000, `${play.calls} plays for 200 iterations of depth 5`);
    assert.ok(rollout.calls <= 200);
    assert.equal(searched.iterations, 200);
    resetTrace();
  });

  // Under `npm run test:coverage`, V8 instruments every function: its allocations are not the library's.
  const covered = process.env.NODE_V8_COVERAGE ? "V8's coverage instruments the code and allocates for it" : false;
  // The young generation's collections say what the turns allocate; a major one may end a marking begun before them.
  it("the beam, the climb and the pool allocate nothing a turn: no young collection over 100 turns, where a beam of objects collects", { skip: covered }, async () => {
    const beam = createBeam({ size: SIZE, width: 120, actions: 10 });
    assert.equal((await collectionsOf(() => beam.run(root, coinGame, { depth: 14, fade: 0.95 }), 100)).minor, 0, "the beam");
    const climb = createClimb({ genes: GENES });
    const rng = createRng(2017);
    assert.equal((await collectionsOf(() => climb.run(climbing, { budget: 1500, rng }), 100)).minor, 0, "the climb");
    const pool = createStatePool(SIZE, 500);
    const refill = () => {
      pool.clear();
      for (let i = 0; i < 500; i += 1) pool.take().set(root);
    };
    assert.equal((await collectionsOf(refill, 1000)).minor, 0, "the pool");
    const control = await collectionsOf(() => objectBeam(120, 14), 30);
    assert.ok(control.minor > 0, `the observer sees the object beam's collections (${control.minor})`);
  });
});

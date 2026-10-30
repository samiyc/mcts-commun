import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diagnose, search } from "../src/mcts.js";
import { createRng } from "../src/random.js";
import { resetTrace, traceSnapshot } from "../src/trace.js";
import { doors, loudLuck, nim, twoJobs } from "./fixtures/problems.js";

describe("the tree search over hidden information (src/mcts.js)", () => {
  it("counts and times the problem's sample, copy, play and rollout: where an iteration goes, read in a trace (30/10)", () => {
    resetTrace();
    const pile = { pile: 7, toMove: "A" };
    const plain = search(pile, nim, { budget: 40, rng: createRng(3) });
    let { counters } = traceSnapshot();
    assert.equal(counters.sample.calls, 40);
    assert.ok(counters.play.calls >= 40, "a move a ply, at least one an iteration");
    assert.ok(counters.rollout.calls <= 40 && counters.rollout.ms >= 0);
    assert.equal(counters.copy, undefined, "no copy, no scope");
    resetTrace();
    const copying = { ...nim, copy: (world) => ({ ...world }) };
    const common = search(pile, copying, { budget: 40, rng: createRng(3), common: true });
    ({ counters } = traceSnapshot());
    assert.equal(counters.copy.calls, 40, "one copy an iteration on common worlds");
    assert.equal(counters.search.iterations, 40);
    assert.deepEqual([plain.move, common.iterations], [search(pile, nim, { budget: 40, rng: createRng(3) }).move, 40], "the same search, counted");
    resetTrace();
  });

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
    assert.deepEqual(diagnose(found), []);
  });

  it("widens below the root as its nodes are visited, never at the root (27/10/2026)", () => {
    const wide = { ...nim, moves: (world) => [1, 2, 3, 4, 5].filter((take) => take <= world.pile) };
    const run = (widening) => search({ pile: 30, toMove: "A" }, wide, { budget: 400, rng: createRng(4), depth: 12, widening });
    const plain = run(0);
    const narrow = run(1);
    assert.equal(narrow.levels[0], 5, "la racine garde ses cinq coups");
    assert.ok(narrow.levels[1] < plain.levels[1], `${narrow.levels} contre ${plain.levels}`);
    assert.ok(narrow.depth > plain.depth, `${narrow.depth} contre ${plain.depth}`);
    assert.equal(narrow.iterations, 400);
  });

  it("stops early once its leader cannot be caught, with the same move (27/10/2026)", () => {
    for (const common of [false, true]) {
      const full = search({}, doors, { budget: 2000, rng: createRng(3), common });
      const early = search({}, doors, { budget: 2000, rng: createRng(3), common, earlyStop: true });
      assert.equal(early.move, full.move);
      assert.ok(early.iterations < 2000, `${early.iterations}`);
      assert.equal(early.stats.reduce((sum, one) => sum + one.visits, 0), early.iterations);
    }
    // Without a budget there is nothing left to count: a deadline alone ignores it.
    let time = 0;
    assert.equal(search({}, doors, { deadline: 50, now: () => (time += 1), earlyStop: true }).iterations, 50);
  });

  it("diagnoses what a search saw: too few iterations, a flat score, a close call, a shallow tree (27/10/2026)", () => {
    const codes = (found, depth) => diagnose(found, { depth }).map((hint) => hint.code);
    assert.deepEqual(codes(search({}, doors, { budget: 2000, rng: createRng(3) }), 1), []);
    // Ten iterations tell nothing: too few, and B tried once leaves its interval wide.
    assert.deepEqual(codes(search({}, doors, { budget: 10, rng: createRng(3) }), 1), ["fewIterations", "closeCall"]);
    assert.deepEqual(codes(search({}, { ...doors, score: () => 0.5 }, { budget: 200 }), 1), ["flatScore"]);
    const evens = { ...doors, sample: (state, rng) => ({ prize: rng.next() < 0.5 ? "A" : "B", opened: null }) };
    assert.deepEqual(codes(search({}, evens, { budget: 200, rng: createRng(3) }), 1), ["closeCall"]);
    const wide = { ...nim, moves: (world) => [1, 2, 3, 4, 5].filter((take) => take <= world.pile) };
    assert.ok(codes(search({ pile: 30, toMove: "A" }, wide, { budget: 30, rng: createRng(2) }), 5).includes("shallow"));
    for (const hint of diagnose(search({}, doors, { budget: 10 }))) assert.match(hint.message, /\S/);
  });

  it("judges a close call by the margin's interval, by pairs on common worlds; never too few after earlyStop (the projects, 27/10)", () => {
    const codes = (found) => diagnose(found, { depth: 1 }).map((hint) => hint.code);
    // A is 0.05 better under a luck worth far more: by pairs the gap is exact, so never close.
    for (let seed = 1; seed <= 10; seed += 1) {
      const found = search({}, loudLuck, { budget: 24, rng: createRng(seed), common: true });
      assert.deepEqual([found.margin.paired, Math.round(100 * found.margin.low), Math.round(100 * found.margin.high)], [true, 5, 5]);
      assert.ok(!codes(found).includes("closeCall"), `graine ${seed}`);
    }
    const plain = search({}, loudLuck, { budget: 24, rng: createRng(2) });
    assert.deepEqual([plain.margin.paired, codes(plain).includes("closeCall")], [false, true], "sans mondes communs, la chance couvre l'écart");
    // Settled by earlyStop after 18 iterations of 30: 9 a move, the saving, not a fault.
    const early = search({}, doors, { budget: 30, rng: createRng(3), earlyStop: true });
    assert.deepEqual([early.stopped, early.iterations, codes(early)], ["settled", 18, []]);
    assert.ok(codes(search({}, doors, { budget: 18, rng: createRng(3) })).includes("fewIterations"));
    assert.equal(search({}, doors, { deadline: 3, now: (() => { let t = 0; return () => (t += 1); })() }).stopped, "deadline");
  });

  it("says a close call settled by earlyStop is moves nearly equivalent, not a want of iterations (cuisine, 28/10/2026)", () => {
    const result = (stopped) => ({ stats: [{ key: "A", mean: 0.61 }, { key: "B", mean: 0.59 }], iterations: 64, margin: { mean: 0.02, low: -0.03, high: 0.07, n: 40, paired: true }, stopped, depth: 2 });
    const [settled] = diagnose(result("settled"), { depth: 2 });
    assert.deepEqual([settled.code, settled.settled], ["closeCall", true]);
    assert.match(settled.message, /presque équivalents/);
    assert.doesNotMatch(settled.message, /plus d'itérations/);
    const [spent] = diagnose(result("budget"), { depth: 2 });
    assert.deepEqual([spent.code, spent.settled], ["closeCall", false]);
    assert.match(spent.message, /plus d'itérations/);
  });

  it("lets a problem keep more moves at the root than below, and says the played move's rank there (Sami, 28/10/2026)", () => {
    // Take 1 to 5, the last to take wins. Four moves at the root, one below.
    const wide = { ...nim, moves: (world) => [1, 2, 3, 4, 5].filter((take) => take <= world.pile), shortlist: (world, moves, { root }) => moves.slice(0, root ? 4 : 1) };
    for (const common of [false, true]) {
      const found = search({ pile: 9, toMove: "A" }, wide, { budget: 400, rng: createRng(5), depth: 3, common });
      // The moves 1 to 4 kept in that order: the move played is its own rank.
      assert.deepEqual(found.rank, { played: found.move, of: 4 }, common ? "en mondes communs" : "sans");
      assert.deepEqual(found.levels.slice(0, 2), [4, 4], "one move a node below the root");
    }
    // A shortlist that ignores where it is keeps one move everywhere, as before.
    const narrow = { ...wide, shortlist: (world, moves) => moves.slice(0, 1) };
    assert.deepEqual(search({ pile: 9, toMove: "A" }, narrow, { budget: 50, rng: createRng(5) }).rank, { played: 1, of: 1 });
  });

  it("draws each common world once with the problem's copy, and searches the same (urgences, 28/10/2026)", () => {
    // A world whose rollout draws again from its stream: the stream must be put back where the draw left it.
    const drawn = { count: 0 };
    const rolled = { ...loudLuck, sample: (state, rng) => ((drawn.count += 1), { luck: rng.next(), chosen: null, late: 0 }), rollout: (world, rng) => ({ ...world, late: rng.next() }) };
    rolled.score = (world) => 0.5 * world.luck + 0.2 * world.late + (world.chosen === "A" ? 0.3 : 0.25);
    const runOf = (problem) => {
      drawn.count = 0;
      const found = search({}, problem, { budget: 40, rng: createRng(5), common: true, depth: 2 });
      return { found: { ...found, ms: 0 }, drawn: drawn.count };
    };
    const plain = runOf(rolled);
    const copied = runOf({ ...rolled, copy: (world) => ({ ...world }) });
    assert.deepEqual(copied.found, plain.found);
    assert.equal(plain.drawn, 41, "un tirage par itération, et celui de la racine");
    assert.equal(copied.drawn, Math.max(...plain.found.stats.map((one) => one.visits)), "le k-ième monde tiré une fois, autant que le coup le plus visité");
    // A copy that is not faithful shows: the same random numbers, other worlds.
    const unfaithful = runOf({ ...rolled, copy: (world) => ({ ...world, luck: 0 }) });
    assert.notDeepEqual(unfaithful.found.stats, plain.found.stats);
  });
});

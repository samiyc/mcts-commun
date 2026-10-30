import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createEvents } from "../src/events.js";
import { eloScore, paired, sprt, wilson } from "../src/measure.js";
import { createRng } from "../src/random.js";

describe("the event queue (src/events.js)", () => {
  it("gives events by time, in their scheduling order between equals, and moves the clock", () => {
    const events = createEvents();
    events.schedule(30, "c");
    events.schedule(10, "a");
    events.schedule(30, "d");
    events.schedule(10, "b");
    assert.equal(events.size, 4);
    assert.deepEqual(events.peek(), { at: 10, event: "a" });
    const seen = [];
    for (let next = events.next(); next; next = events.next()) seen.push(`${next.event}@${events.now}`);
    assert.deepEqual(seen, ["a@10", "b@10", "c@30", "d@30"]);
    assert.equal(events.next(), null);
    assert.throws(() => events.schedule(5, "late"), /passé/);
  });

  it("clones at the same clock, keeping the events asked, in their order", () => {
    const events = createEvents();
    for (const [at, name] of [[5, "a"], [5, "b"], [2, "x"], [9, "c"]]) events.schedule(at, name);
    events.next();
    const copy = events.clone((name) => name !== "b");
    assert.equal(copy.now, 2);
    const seen = [];
    for (let next = copy.next(); next; next = copy.next()) seen.push(next.event);
    assert.deepEqual(seen, ["a", "c"]);
    assert.equal(events.size, 3, "l'original n'a pas bougé");
  });

  it("stays in order over many random events", () => {
    const rng = createRng(4);
    const events = createEvents();
    for (let i = 0; i < 2000; i += 1) events.schedule(Math.floor(rng.next() * 500), i);
    let last = { at: -1, event: -1 };
    for (let next = events.next(); next; next = events.next()) {
      assert.ok(next.at > last.at || (next.at === last.at && next.event > last.event));
      last = next;
    }
  });
});

describe("the measures (src/measure.js)", () => {
  it("gives Wilson's interval, inside [0, 1]", () => {
    const { rate, low, high } = wilson(55, 100);
    assert.equal(rate, 0.55);
    assert.ok(Math.abs(low - 0.452) < 0.001 && Math.abs(high - 0.644) < 0.001, `${low} – ${high}`);
    assert.deepEqual(wilson(0, 0), { rate: 0, low: 0, high: 1 });
    assert.equal(wilson(10, 10).high, 1);
  });

  it("compares two rules by pairs on the same scenarios", () => {
    const a = [3, 5, 4, 6, 5];
    const b = [2, 5, 3, 4, 6];
    const gap = paired(a, b);
    assert.equal(gap.n, 5);
    assert.equal(gap.mean, 0.6);
    assert.ok(gap.low < 0.6 && gap.high > 0.6);
    assert.deepEqual([gap.wins, gap.ties, gap.losses], [3, 1, 1]);
    assert.throws(() => paired([1], [1, 2]), /inégales/);
  });

  it("counts an Elo gap as chess engines do", () => {
    assert.equal(eloScore(0), 0.5);
    assert.ok(Math.abs(eloScore(400) - 10 / 11) < 1e-12);
    assert.ok(Math.abs(eloScore(35) + eloScore(-35) - 1) < 1e-12);
  });

  it("decides a sequential test only past its bounds, never before minSamples, and refuses h1 under h0", () => {
    const early = sprt(Array(19).fill(1), { h0: 0.5, h1: eloScore(10) });
    assert.deepEqual([early.llr, early.verdict], [0, "continue"]);
    assert.ok(Math.abs(early.upper - Math.log(0.95 / 0.05)) < 1e-12 && Math.abs(early.lower + early.upper) < 1e-12);
    assert.equal(sprt(Array(20).fill(1), { h0: 0.5, h1: 0.6 }).verdict, "h1", "all won");
    assert.equal(sprt(Array(20).fill(0), { h0: 0.5, h1: 0.6 }).verdict, "h0", "all lost");
    assert.equal(sprt(Array(20).fill(0.5), { h0: 0.25, h1: 0.75 }).verdict, "continue", "right between, no spread");
    assert.throws(() => sprt([1], { h0: 0.5, h1: 0.5 }), /h1/);
  });

  it("stops a series early and errs about as often as asked, on games and on paired gaps", () => {
    /** Draws samples one by one until the test decides: the verdict and the samples it took. */
    const run = (draw, hypotheses) => {
      const samples = [];
      for (;;) {
        samples.push(draw());
        const { verdict } = sprt(samples, hypotheses);
        if (verdict !== "continue") return { verdict, n: samples.length };
      }
    };
    const games = { h0: 0.5, h1: 0.6 };
    const tally = (p, seed) => {
      const rng = createRng(seed);
      return run(() => (rng.next() < p ? 1 : 0), games);
    };
    const series = (p) => Array.from({ length: 200 }, (_, i) => tally(p, 1000 + i));
    const better = series(0.6);
    const same = series(0.5);
    assert.ok(better.filter((one) => one.verdict === "h0").length <= 20, "beta 5 %, with room");
    assert.ok(same.filter((one) => one.verdict === "h1").length <= 20, "alpha 5 %, with room");
    const meanN = (list) => list.reduce((sum, one) => sum + one.n, 0) / list.length;
    // A fixed series that tells 60 % from 50 % at these error rates plays about 270 games.
    assert.ok(meanN(better) < 270 && meanN(same) < 270, `${meanN(better)} and ${meanN(same)} games`);
    const rng = createRng(7);
    const gaps = Array.from({ length: 50 }, () => run(() => 2 + 5 * rng.normal(), { h0: 0, h1: 2 }));
    assert.ok(gaps.filter((one) => one.verdict === "h1").length >= 45, "a gain of 2 on a spread of 5");
  });
});

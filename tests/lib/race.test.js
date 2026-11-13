import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalQuantile } from "../../src/measure.js";
import { commonSeeds, nextBatch, raceStep } from "../../src/race.js";
import { createRng } from "../../src/random.js";

/** Seeds 1 to `n` of each variant, won with its probability: `{ a: 0.6, b: 0.5 }`. */
function played(rates, n, seed = 7) {
  const rng = createRng(seed);
  const results = {};
  for (const variant of Object.keys(rates)) results[variant] = {};
  for (let s = 1; s <= n; s += 1) for (const [variant, rate] of Object.entries(rates)) results[variant][s] = rng.next() < rate ? 1 : 0;
  return results;
}

describe("the normal quantile (src/measure.js)", () => {
  it("gives the usual thresholds, symmetric about the middle", () => {
    assert.ok(Math.abs(normalQuantile(0.975) - 1.959964) < 1e-6);
    assert.ok(Math.abs(normalQuantile(0.99) - 2.326348) < 1e-6);
    assert.ok(Math.abs(normalQuantile(0.001) + 3.090232) < 1e-6);
    assert.equal(normalQuantile(0.5), 0);
    assert.throws(() => normalQuantile(1), /entre 0 et 1/);
  });
});

describe("a race of configurations (src/race.js, Sami 12/11/2026)", () => {
  it("drops a variant the best beats, keeps those it cannot tell apart", () => {
    const step = raceStep(played({ a: 0.6, b: 0.55, c: 0.3 }, 200), ["a", "b", "c"]);
    assert.equal(step.seeds, 200);
    assert.equal(step.best, "a");
    assert.deepEqual(step.dropped.map((one) => one.variant), ["c"]);
    assert.deepEqual(step.alive, ["a", "b"]);
    assert.ok(step.dropped[0].gap.high < 0, "c's gap to a, with its interval, under 0");
  });

  it("drops nothing before its minimum of seeds, nor with one variant left", () => {
    const results = played({ a: 0.9, b: 0.1 }, 20);
    assert.deepEqual(raceStep(results, ["a", "b"]).dropped, [], "20 seeds, 30 asked");
    assert.deepEqual(raceStep(results, ["a", "b"], { minSeeds: 10 }).alive, ["a"]);
    assert.deepEqual(raceStep(results, ["a"], { minSeeds: 1 }).dropped, []);
  });

  it("shares alpha among the comparisons: more variants, a wider interval", () => {
    const results = played({ a: 0.6, b: 0.5, c: 0.6, d: 0.6, e: 0.6, f: 0.6 }, 400, 3);
    const alone = raceStep(results, ["a", "b"]).dropped.find((one) => one.variant === "b");
    const among = raceStep(results, ["a", "b", "c", "d", "e", "f"]).dropped.find((one) => one.variant === "b");
    assert.ok(alone, "b is beaten by a alone");
    assert.ok(!among || among.gap.high - among.gap.low > alone.gap.high - alone.gap.low);
  });

  it("ranks by the least when a score is a cost", () => {
    const waits = { fixed: { 1: 50, 2: 60, 3: 55 }, pressure: { 1: 30, 2: 35, 3: 33 } };
    const step = raceStep(waits, ["fixed", "pressure"], { minSeeds: 3, maximize: false });
    assert.equal(step.best, "pressure");
    assert.deepEqual(step.alive, ["pressure"]);
  });

  it("compares only the seeds every variant has played, in numeric order", () => {
    const results = { a: { 1: 1, 2: 0, 10: 1 }, b: { 2: 1, 10: 0, 11: 1 } };
    assert.deepEqual(commonSeeds(results, ["a", "b"]), ["2", "10"]);
    assert.deepEqual(commonSeeds(results, []), []);
    assert.equal(raceStep(results, ["a", "b"]).seeds, 2);
  });

  it("gives the next batch of seeds until the race has played its budget", () => {
    assert.deepEqual(nextBatch({ played: 0, batch: 50, maxSeeds: 120 }), { from: 1, count: 50 });
    assert.deepEqual(nextBatch({ played: 100, batch: 50, maxSeeds: 120 }), { from: 101, count: 20 });
    assert.deepEqual(nextBatch({ played: 50, batch: 50, maxSeeds: 500, first: 1001 }), { from: 1051, count: 50 });
    assert.equal(nextBatch({ played: 120, batch: 50, maxSeeds: 120 }), null);
  });

  it("keeps its risk when it looks at every batch: alpha shared among the looks (200 races of equal variants)", () => {
    let lost = 0;
    for (let race = 0; race < 200; race += 1) {
      const all = played({ a: 0.5, b: 0.5 }, 1000, race + 1);
      let alive = ["a", "b"];
      for (let seeds = 50; seeds <= 1000 && alive.length > 1; seeds += 50) {
        const sliced = Object.fromEntries(alive.map((v) => [v, Object.fromEntries(Object.entries(all[v]).slice(0, seeds))]));
        alive = raceStep(sliced, alive, { looks: 20 }).alive;
      }
      if (alive.length < 2) lost += 1;
    }
    assert.ok(lost <= 16, `${lost} races of 200 dropped one of two equal variants (5 % asked)`);
  });

  it("stops a beaten variant far sooner than a fixed series, on 200 seeded races", () => {
    let seedsPlayed = 0;
    let wrong = 0;
    for (let race = 0; race < 200; race += 1) {
      const all = played({ a: 0.6, b: 0.4 }, 1000, race + 1);
      let alive = ["a", "b"];
      let seeds = 0;
      while (alive.length > 1 && seeds < 1000) {
        seeds += 50;
        const sliced = Object.fromEntries(alive.map((v) => [v, Object.fromEntries(Object.entries(all[v]).slice(0, seeds))]));
        alive = raceStep(sliced, alive, { looks: 20 }).alive;
      }
      seedsPlayed += seeds;
      if (alive[0] !== "a") wrong += 1;
    }
    assert.ok(seedsPlayed / 200 < 300, `${seedsPlayed / 200} seeds a race, where a fixed series plays 1 000`);
    assert.ok(wrong <= 4, `${wrong} races of 200 kept the worse variant`);
  });
});

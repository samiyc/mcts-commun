import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRng, streamOf } from "../src/random.js";

describe("the seeded draw (src/random.js)", () => {
  it("gives the same numbers from the same seed, others from another, all in [0, 1)", () => {
    const draws = (seed) => Array.from({ length: 5 }, createRng(seed).next);
    assert.deepEqual(draws(7), draws(7));
    assert.notDeepEqual(draws(7), draws(8));
    assert.ok(draws(3).every((value) => value >= 0 && value < 1));
  });

  it("draws the same numbers as Lopin's, so a scenario moved from there replays", () => {
    // createRng(1).next() in lopin/src/core/random.js on 22/10/2026.
    assert.equal(createRng(1).next(), 0.6270739405881613);
  });

  it("clones, shuffles, and keeps one stream's draws apart from another's", () => {
    const rng = createRng(5);
    rng.next();
    assert.equal(rng.clone().next(), rng.next());
    assert.deepEqual([...createRng(2).shuffle([1, 2, 3, 4, 5])].sort(), [1, 2, 3, 4, 5]);
    assert.notEqual(streamOf(9, 0).next(), streamOf(9, 1).next());
    assert.equal(streamOf(9, 1).next(), streamOf(9, 1).next());
  });

  it("draws normals around 0 with a spread of 1", () => {
    const rng = createRng(11);
    const values = Array.from({ length: 4000 }, () => rng.normal());
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
    assert.ok(Math.abs(mean) < 0.05, `moyenne ${mean}`);
    assert.ok(Math.abs(sd - 1) < 0.05, `écart-type ${sd}`);
  });
});

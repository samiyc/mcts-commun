import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import * as events from "../src/events.js";
import * as grid from "../src/grid.js";
import * as mcts from "../src/mcts.js";
import * as measure from "../src/measure.js";
import * as random from "../src/random.js";
import * as trace from "../src/trace.js";
import { doors, nim, twoJobs } from "./fixtures/problems.js";

/**
 * The library's contract (Sami, 22/10/2026): what each module exports, the shape of what the search
 * returns, the README's signatures, and the search's fingerprint. The projects build on these: a change
 * here is a change for every one of them, made on purpose, with this file and the README.
 */
const { createRng } = random;
const { search } = mcts;
const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

/** The search's moves on seeded toy problems, hashed: a speed-up must keep it (lopin's fingerprint rule). */
const FINGERPRINT = "f80ea0808e763c6b";

describe("the library's contract (tests/api.test.js)", () => {
  it("exports what the projects import, and nothing hidden behind", () => {
    assert.deepEqual(Object.keys(random).sort(), ["createRng", "streamOf"]);
    assert.deepEqual(Object.keys(events), ["createEvents"]);
    assert.deepEqual(Object.keys(grid).sort(), ["astar", "createReservations", "parsePlan"]);
    assert.deepEqual(Object.keys(grid.createReservations()).sort(), ["clone", "freeFrom", "isFree", "release", "reserve", "swaps"]);
    assert.deepEqual(Object.keys(measure).sort(), ["paired", "wilson"]);
    assert.deepEqual(Object.keys(events.createEvents()).sort(), ["clone", "next", "now", "peek", "schedule", "size"]);
    assert.deepEqual(Object.keys(measure.paired([1], [0])), ["n", "mean", "low", "high", "wins", "ties", "losses"]);
    assert.deepEqual(Object.keys(mcts).sort(), ["PROBLEM", "SEARCH", "checkProblem", "search"]);
    assert.deepEqual(Object.keys(createRng(1)).sort(), ["clone", "getState", "int", "next", "normal", "setState", "shuffle"]);
    assert.deepEqual(mcts.SEARCH, { depth: 5, explore: 0.7 });
    assert.deepEqual(Object.keys(trace).sort(), ["DEBUG_CAP", "RING", "SLOW_MS", "count", "onPulse", "resetTrace", "setTraceLevel", "timed", "trace", "traceLevel", "traceSnapshot", "traceTo"]);
  });

  it("returns the search's result in its stated shape", () => {
    const found = search({}, doors, { budget: 50 });
    assert.deepEqual(Object.keys(found), ["move", "value", "visits", "stats", "size"]);
    assert.ok(found.visits instanceof Map);
    assert.deepEqual(Object.keys(found.stats[0]), ["key", "move", "visits", "mean"]);
    assert.equal(typeof found.value, "number");
    assert.equal(typeof found.size, "number");
  });

  it("states in the README the same Problem and the same search as the code", () => {
    const stated = [...README.matchAll(/@property \{[^}]*\} \[?(\w+)\]?/g)].map((match) => match[1]);
    assert.deepEqual(stated.sort(), [...mcts.PROBLEM.required, ...mcts.PROBLEM.optional].sort());
    assert.match(README, /\[shortlist\]/);
    assert.match(README, /export function search\(state, problem, \{ budget, rng, depth = 5, explore = 0\.7, common = false \}\)/);
    assert.match(README, /move: Move \| null, value: number, visits: Map<string, number>, stats: object\[\], size: number/);
  });

  it("keeps its fingerprint: the same moves and visits on the seeded toy problems", () => {
    const runs = [
      search({ pile: 9, toMove: "A" }, nim, { budget: 500, rng: createRng(8), depth: 6 }),
      search({}, doors, { budget: 300, rng: createRng(3) }),
      search({ due: { id: "long", at: 75 }, ends: {} }, twoJobs, { budget: 200, rng: createRng(5) }),
    ];
    const text = JSON.stringify(runs.map(({ stats, size }) => ({ stats: stats.map(({ key, visits, mean }) => [key, visits, mean]), size })));
    assert.equal(createHash("sha256").update(text).digest("hex").slice(0, 16), FINGERPRINT);
  });

  it("imports nothing of Node in its modules, so the page can load them", () => {
    for (const file of readdirSync(new URL("../src/", import.meta.url)).filter((name) => name.endsWith(".js"))) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /from "node:/, file);
    }
  });
});

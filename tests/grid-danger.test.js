import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dangerTimeline, escapeRoutes, parsePlan } from "../src/grid.js";

/**
 * Danger in time on a grid (Sami, 28/10/2026: two tricks of his Hypersonic Legend bot, read again by mcts-codingame,
 * added as an option).
 */
const wall = (char) => char === "#";
const box = (char) => char === "+";
const floor = (char) => char === ".";
const cellOf = (plan, x, y) => y * plan.width + x;

describe("danger in time on a grid (src/grid-danger.js, Sami 28/10)", () => {
  const plan = parsePlan(["#########", "#.......#", "#.#+#.#.#", "#.......#", "#########"].join("\n"));

  it("says when each cell burns, walls stopping a blast, a box taking it, a bomb hit going off with the one that hit it", () => {
    const sources = [
      { x: 1, y: 1, delay: 3, range: 3 },
      { x: 4, y: 1, delay: 8, range: 2 },
      { x: 3, y: 3, delay: 5, range: 3 },
    ];
    const { at, delays } = dangerTimeline(plan, sources, { blocks: wall, absorbs: box });
    assert.deepEqual(delays, [3, 3, 5], "the second bomb, in the first's blast, goes off with it");
    assert.equal(at[cellOf(plan, 6, 1)], 3, "the chained bomb's blast, at the first one's turn");
    assert.equal(at[cellOf(plan, 1, 3)], 3);
    assert.equal(at[cellOf(plan, 3, 2)], 5, "the box is hit");
    assert.equal(at[cellOf(plan, 0, 1)], -1, "the wall is not");
    assert.equal(at[cellOf(plan, 4, 2)], -1, "a wall under the second bomb stops its blast down");
    // Without the chain, the second bomb keeps its own delay.
    assert.equal(dangerTimeline(plan, sources, { blocks: wall, absorbs: box, chain: false }).at[cellOf(plan, 6, 1)], 8);
  });

  it("finds the first steps that lead out of every blast in time, waiting allowed, and none when there is no way", () => {
    const corridor = parsePlan(["#####", "#...#", "#####"].join("\n"));
    const steps = (sources, from = { x: 1, y: 1 }) => escapeRoutes(corridor, from, { danger: dangerTimeline(corridor, sources, { blocks: wall }), passable: floor }).map((one) => one.steps);
    // Our bomb under us, range 1: right then right again, out of it at turn 2.
    assert.deepEqual(steps([{ x: 1, y: 1, delay: 2, range: 1 }]), [-1, 2, -1, -1, -1]);
    // Range 2 reaches the end of the corridor: no way out, so do not lay it.
    assert.deepEqual(steps([{ x: 1, y: 1, delay: 2, range: 2 }]), [-1, -1, -1, -1, -1]);
    // Out of reach already: staying is safe at once.
    assert.deepEqual(steps([{ x: 3, y: 1, delay: 2, range: 0 }])[0], 0);
    // Right at once dies in it; stay a turn, then step on it at turn 2, its fire out: safe there.
    assert.deepEqual(steps([{ x: 2, y: 1, delay: 1, range: 0 }, { x: 1, y: 1, delay: 4, range: 0 }]), [2, -1, -1, -1, -1]);
  });

  it("counts a cell deadly from its first blast to its last, as a bot must", () => {
    const corridor = parsePlan(["#####", "#...#", "#####"].join("\n"));
    const danger = dangerTimeline(corridor, [{ x: 2, y: 1, delay: 1, range: 0 }, { x: 2, y: 1, delay: 5, range: 0, sides: [] }], { chain: false });
    assert.deepEqual([danger.at[cellOf(corridor, 2, 1)], danger.until[cellOf(corridor, 2, 1)]], [1, 5]);
    const routes = escapeRoutes(corridor, { x: 2, y: 1 }, { danger, passable: floor });
    assert.deepEqual(routes.map((one) => one.steps), [-1, 1, 1, -1, -1], "leave at once, either side; never stay");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { astar, createReservations, parsePlan } from "../src/grid.js";

const open = (char) => char !== "#";
const PLAN = parsePlan(`
#######
#A....#
#.###.#
#....B#
#######
`.slice(1));

describe("plans and paths (src/grid.js)", () => {
  it("reads a plan drawn as text and finds its marks", () => {
    assert.equal(PLAN.width, 7);
    assert.equal(PLAN.height, 5);
    assert.deepEqual(PLAN.find("A"), [{ x: 1, y: 1 }]);
    assert.equal(PLAN.at(0, 0), "#");
    assert.equal(PLAN.at(9, 9), null);
    assert.equal(parsePlan("ab\nc").at(1, 1), " ");
  });

  it("finds a shortest path around the walls, one cell a step", () => {
    const path = astar(PLAN, { x: 1, y: 1 }, { x: 5, y: 3 }, { passable: open });
    assert.equal(path.length - 1, 6);
    assert.deepEqual(path[0], { x: 1, y: 1, t: 0 });
    assert.deepEqual(path.at(-1), { x: 5, y: 3, t: 6 });
    for (let i = 1; i < path.length; i += 1) assert.equal(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y), 1);
    assert.equal(astar(PLAN, { x: 1, y: 1 }, { x: 3, y: 2 }, { passable: open }), null);
  });

  it("goes around a unit already on the way, never into its cell at the same moment", () => {
    const reservations = createReservations();
    const corridor = parsePlan("#####\n#...#\n#####");
    const first = astar(corridor, { x: 1, y: 1 }, { x: 3, y: 1 }, { passable: open });
    reservations.reserve("r1", first, { stay: true });
    // The second unit wants to cross the first one's goal: it is held for good, so there is no way.
    assert.equal(astar(corridor, { x: 3, y: 1 }, { x: 1, y: 1 }, { passable: open, reservations, unit: "r2", horizon: 20 }), null);
    reservations.release("r1");
    assert.ok(astar(corridor, { x: 3, y: 1 }, { x: 1, y: 1 }, { passable: open, reservations, unit: "r2" }));
  });

  it("waits or steps aside rather than swap cells with another unit", () => {
    const reservations = createReservations();
    const wide = parsePlan("#####\n#...#\n#...#\n#####");
    const east = astar(wide, { x: 1, y: 1 }, { x: 3, y: 1 }, { passable: open });
    reservations.reserve("east", east);
    const west = astar(wide, { x: 3, y: 1 }, { x: 1, y: 1 }, { passable: open, reservations, unit: "west" });
    for (const step of west) assert.ok(!east.some((other) => other.t === step.t && other.x === step.x && other.y === step.y), `même case à ${step.t}`);
    for (let t = 0; t + 1 < Math.min(west.length, east.length); t += 1) {
      const swapped = west[t].x === east[t + 1].x && west[t].y === east[t + 1].y && west[t + 1].x === east[t].x && west[t + 1].y === east[t].y;
      assert.ok(!swapped, `échange à ${t}`);
    }
    assert.deepEqual(west.at(-1), { x: 1, y: 1, t: west.length - 1 });
  });
});

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

  it("parks only where nobody else is due later", () => {
    const reservations = createReservations();
    const hall = parsePlan("#######\n#.....#\n#.....#\n#######");
    // A passes through (3, 1) at t = 4 on its way east, and parks at (5, 1).
    reservations.reserve("A", [{ x: 1, y: 1, t: 2 }, { x: 2, y: 1, t: 3 }, { x: 3, y: 1, t: 4 }, { x: 4, y: 1, t: 5 }, { x: 5, y: 1, t: 6 }], { stay: true });
    assert.equal(reservations.freeFrom(3, 1, 1, "B"), false);
    assert.equal(reservations.freeFrom(3, 1, 5, "B"), true);
    assert.equal(reservations.freeFrom(5, 1, 9, "B"), false, "A s'y gare");
    const passing = astar(hall, { x: 2, y: 2 }, { x: 3, y: 1 }, { passable: open, reservations, unit: "B" });
    assert.equal(passing.at(-1).t, 2);
    const parked = astar(hall, { x: 2, y: 2 }, { x: 3, y: 1 }, { passable: open, reservations, unit: "B", park: true });
    assert.ok(parked.at(-1).t >= 5, `arrivé à ${parked.at(-1).t}`);
  });

  it("never lets a unit's own old steps hide another unit parked there since", () => {
    const reservations = createReservations();
    // B planned through (3, 1) at t = 4; then A stopped there for good, from t = 2.
    reservations.reserve("B", [{ x: 1, y: 1, t: 2 }, { x: 2, y: 1, t: 3 }, { x: 3, y: 1, t: 4 }, { x: 4, y: 1, t: 5 }], { stay: true });
    reservations.reserve("A", [{ x: 3, y: 1, t: 2 }], { stay: true });
    assert.equal(reservations.isFree(3, 1, 4, "B"), false, "A y est garé");
    assert.equal(reservations.isFree(3, 1, 1, "B"), true, "avant que A s'y gare");
    // B planning again, its old steps still held, goes around A.
    const hall = parsePlan("#######\n#.....#\n#.....#\n#######");
    const path = astar(hall, { x: 1, y: 1 }, { x: 5, y: 1 }, { passable: open, reservations, unit: "B", start: 2 });
    assert.ok(path.every((step) => step.x !== 3 || step.y !== 1), JSON.stringify(path));
  });

  it("clones a table: the copy and the original then go their own ways", () => {
    const reservations = createReservations();
    reservations.reserve("A", [{ x: 1, y: 1, t: 0 }, { x: 2, y: 1, t: 1 }], { stay: true });
    const copy = reservations.clone();
    copy.release("A");
    assert.equal(copy.isFree(2, 1, 5, "B"), true);
    assert.equal(reservations.isFree(2, 1, 5, "B"), false);
    reservations.reserve("C", [{ x: 3, y: 3, t: 2 }]);
    assert.equal(copy.isFree(3, 3, 2, "B"), true);
  });

  it("lets units share a cell such as a dock, but never cross on its edge", () => {
    const dock = { x: 3, y: 1 };
    const reservations = createReservations({ shared: [dock] });
    const line = parsePlan("#####\n#...#\n#####");
    const leaving = astar(line, dock, { x: 1, y: 1 }, { passable: open });
    reservations.reserve("out", leaving, { stay: true });
    assert.ok(reservations.isFree(3, 1, 0, "in"), "le quai reste libre");
    const coming = astar(line, { x: 2, y: 1 }, dock, { passable: open, reservations, unit: "in" });
    // Leaving moves 3 → 2 at t = 0; coming may not move 2 → 3 at the same moment.
    assert.equal(coming, null);
    reservations.release("out");
    reservations.reserve("parked", [{ x: 3, y: 1, t: 0 }], { stay: true });
    assert.ok(reservations.isFree(3, 1, 5, "other"), "on ne se gare pas sur une case partagée");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { astar, createDistances, createReservations, parsePlan } from "../src/grid.js";
import { resetTrace, traceSnapshot } from "../src/trace.js";

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

  it("gives up at once on a target walled off by a unit parked for good, not before it parks (27/10/2026)", () => {
    const tee = parsePlan(["#######", "#.....#", "###.###", "###.###", "#######"].join("\n"));
    const reservations = createReservations();
    const down = [0, 1, 2, 3].map((t) => ({ x: 3, y: 3, t }));
    reservations.reserve("r1", [...down, { x: 3, y: 2, t: 4 }, { x: 3, y: 1, t: 5 }], { stay: true });
    assert.deepEqual(reservations.stayAt(3, 1), { unit: "r1", from: 5 });
    assert.equal(reservations.stayAt(1, 1), null);
    // Before it parks, the way is open; after, there is none, and a horizon of a million steps costs nothing.
    assert.ok(astar(tee, { x: 1, y: 1 }, { x: 5, y: 1 }, { passable: open, reservations, unit: "r2", park: true }));
    const begin = performance.now();
    assert.equal(astar(tee, { x: 1, y: 1 }, { x: 5, y: 1 }, { passable: open, reservations, unit: "r2", start: 6, horizon: 1e6, park: true }), null);
    assert.ok(performance.now() - begin < 200);
  });

  it("checks a target out of reach in a breadth-first pass that stays small on a wide plan (27/10/2026)", () => {
    // Walls round (35, 10) on a 40 × 20 plan: the bound's layers held each cell once per neighbour, 4 s at horizon 20.
    const rows = Array.from({ length: 20 }, (_, y) => Array.from({ length: 40 }, (_, x) => (y % 19 === 0 || x % 39 === 0 ? "#" : ".")));
    for (const [x, y] of [[34, 9], [35, 9], [36, 9], [34, 10], [36, 10], [34, 11], [35, 11], [36, 11]]) rows[y][x] = "#";
    const wide = parsePlan(rows.map((row) => row.join("")).join("\n"));
    const begin = performance.now();
    assert.equal(astar(wide, { x: 2, y: 2 }, { x: 35, y: 10 }, { passable: open, reservations: createReservations(), unit: "a", horizon: 80 }), null);
    assert.ok(performance.now() - begin < 1000, `${Math.round(performance.now() - begin)} ms`);
    // The walls alone, without reservations, give the same answer as soon.
    assert.equal(astar(wide, { x: 2, y: 2 }, { x: 35, y: 10 }, { passable: open, horizon: 80 }), null);
  });

  it("bounds a search short of time: beyond the horizon, beyond maxNodes, or the partial path towards the target (27/10/2026)", () => {
    const hall = parsePlan(["############", "#..........#", "#..........#", "############"].join("\n"));
    const far = { x: 10, y: 2 };
    resetTrace();
    assert.equal(astar(hall, { x: 1, y: 1 }, far, { passable: open, horizon: 5 }), null, "10 pas pour un horizon de 5");
    assert.equal(traceSnapshot().counters.astar.expanded, 0, "rien d'exploré");
    assert.equal(astar(hall, { x: 1, y: 1 }, far, { passable: open, maxNodes: 4 }), null);
    assert.equal(traceSnapshot().counters.astar.capped, 1);
    const partial = astar(hall, { x: 1, y: 1 }, far, { passable: open, maxNodes: 4, partial: true });
    assert.ok(Math.abs(partial.at(-1).x - far.x) + Math.abs(partial.at(-1).y - far.y) < 10, JSON.stringify(partial));
    // Out of time but not of patience: towards the target as far as the horizon lets it.
    const towards = astar(hall, { x: 1, y: 1 }, far, { passable: open, horizon: 5, partial: true });
    assert.deepEqual(towards.at(-1), { x: 6, y: 1, t: 5 });
    assert.equal(traceSnapshot().counters.astar.partial, 2);
    assert.deepEqual(astar(hall, { x: 1, y: 1 }, far, { passable: open, maxNodes: 100 }), astar(hall, { x: 1, y: 1 }, far, { passable: open }));
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

  it("gives up early on a unit shut in a dead end, long before the plan's size, the partial path unchanged (28/10/2026)", () => {
    const pocket = parsePlan(["##########", "#.##.....#", "#.##.....#", "##########"].join("\n"));
    resetTrace();
    assert.equal(astar(pocket, { x: 1, y: 1 }, { x: 8, y: 2 }, { passable: open, horizon: 80 }), null);
    const { expanded, givenUp } = traceSnapshot().counters.astar;
    assert.deepEqual([givenUp, expanded <= 2 * (8 + 1) + 8], [1, true], `${expanded} nœuds`);
    const partial = astar(pocket, { x: 1, y: 1 }, { x: 8, y: 2 }, { passable: open, horizon: 80, partial: true });
    assert.deepEqual(partial.at(-1), { x: 1, y: 2, t: 1 });
  });

  it("holds two units a cell with a capacity, one on a single cell, and lets them cross in an aisle (cuisine, 28/10/2026)", () => {
    const aisle = parsePlan(["#######", "#.....#", "#######"].join("\n"));
    const table = createReservations({ capacity: 2, single: [{ x: 5, y: 1 }] });
    table.reserve("a", [{ x: 2, y: 1, t: 0 }, { x: 3, y: 1, t: 1 }]);
    assert.ok(table.isFree(3, 1, 1, "b"), "une place encore");
    table.reserve("b", [{ x: 4, y: 1, t: 0 }, { x: 3, y: 1, t: 1 }]);
    assert.ok(!table.isFree(3, 1, 1, "c"), "pleine à deux");
    assert.ok(table.isFree(3, 1, 1, "a"), "on ne se compte pas soi-même");
    // Face to face between two cells of capacity 2: they pass, where a table of one makes one wait.
    assert.ok(!table.swaps({ x: 3, y: 1 }, { x: 2, y: 1 }, 0, "c"));
    const one = createReservations();
    one.reserve("a", [{ x: 2, y: 1, t: 0 }, { x: 3, y: 1, t: 1 }]);
    assert.ok(one.swaps({ x: 3, y: 1 }, { x: 2, y: 1 }, 0, "b"));
    const crossed = astar(aisle, { x: 3, y: 1 }, { x: 1, y: 1 }, { passable: open, reservations: table, unit: "c" });
    assert.equal(crossed.length, 3, JSON.stringify(crossed));
    // The single cell holds one, and parking still wants a cell alone.
    table.reserve("d", [{ x: 5, y: 1, t: 4 }]);
    assert.ok(!table.isFree(5, 1, 4, "e"));
    assert.ok(!table.freeFrom(3, 1, 0, "c"), "a et b y passent plus tard");
    assert.throws(() => createReservations({ capacity: 0 }), /capacity/);
    assert.throws(() => table.reserve("f", [{ x: 5000, y: 1, t: 0 }]), /hors des cases/);
  });

  it("counts a cell booked over its capacity, the latest units keeping it", () => {
    resetTrace();
    const table = createReservations({ capacity: 2 });
    for (const unit of ["a", "b", "c"]) table.reserve(unit, [{ x: 1, y: 1, t: 0 }]);
    assert.equal(traceSnapshot().counters.grid.overbooked, 1);
    table.release("c");
    assert.ok(table.isFree(1, 1, 0, "z"), "b seul y reste, a a perdu sa place");
  });

  it("follows the floor's distances when every step is free, A* when one is taken (direct, the kitchen's way, 28/10/2026)", () => {
    const distances = createDistances(PLAN, open);
    resetTrace();
    const free = astar(PLAN, { x: 1, y: 1 }, { x: 5, y: 3 }, { passable: open, direct: distances });
    assert.deepEqual(free.map(({ x, y }) => [x, y]), [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [5, 2], [5, 3]]);
    assert.equal(traceSnapshot().counters.astar.direct, 1);
    // Another unit on the way at that moment: A* goes round, or waits.
    const table = createReservations();
    table.reserve("b", [{ x: 3, y: 1, t: 2 }]);
    const round = astar(PLAN, { x: 1, y: 1 }, { x: 5, y: 3 }, { passable: open, reservations: table, unit: "a", direct: distances });
    assert.ok(!round.some(({ x, y, t }) => x === 3 && y === 1 && t === 2), JSON.stringify(round));
    assert.equal(traceSnapshot().counters.astar.direct, 1, "A*, pas le trajet direct");
    // Beyond the horizon, or a target someone parks on later: never the direct path.
    assert.equal(astar(PLAN, { x: 1, y: 1 }, { x: 5, y: 3 }, { passable: open, horizon: 5, direct: distances }), null);
    table.reserve("c", [{ x: 5, y: 3, t: 9 }]);
    const parked = astar(PLAN, { x: 1, y: 1 }, { x: 5, y: 3 }, { passable: open, reservations: table, unit: "a", park: true, direct: distances });
    assert.ok(parked === null || parked.at(-1).t > 9, JSON.stringify(parked));
    assert.equal(traceSnapshot().counters.astar.direct, 1);
    // Distances from a more permissive floor than the call's (the warehouse, 28/10): a step this call forbids is A*'s.
    const closed = (char, x, y) => open(char) && !(x === 3 && y === 1);
    const aside = astar(PLAN, { x: 1, y: 1 }, { x: 5, y: 3 }, { passable: closed, direct: distances });
    assert.deepEqual(aside, astar(PLAN, { x: 1, y: 1 }, { x: 5, y: 3 }, { passable: closed }));
    assert.equal(traceSnapshot().counters.astar.direct, 1, "A*, pas le trajet direct");
  });
});

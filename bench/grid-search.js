import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * What A*, the reservations and the search on common worlds cost, on fixed seeded cases (28/10/2026: the projects'
 * profiles; Sami wanted the gain seen before the queue measures it). `node bench/grid-search.js [SRC]` times the
 * library in SRC (`src` by default: an older copy's, from a git worktree, to compare) and prints one line of JSON:
 * microseconds a call, and nodes a call for A*. Run it beside the queue under `mcts-backlog --slot 1`.
 */
const source = path.resolve(process.argv[2] ?? fileURLToPath(new URL("../src", import.meta.url)));
const load = (name) => import(pathToFileURL(path.join(source, name)).href);
const grid = await load("grid.js");
const { astar, createReservations, parsePlan } = grid;
const { createRng } = await load("random.js");
const { search } = await load("mcts.js");
const { resetTrace, traceSnapshot } = await load("trace.js");

const passable = (char) => char !== "#";

/** A warehouse: racks two cells deep in rows, aisles between them, a wall round. */
function warehouse(width, height) {
  const edge = (x, y) => x === 0 || y === 0 || x === width - 1 || y === height - 1;
  const rack = (x, y) => y % 4 !== 0 && x % 6 >= 2 && x % 6 <= 3;
  const rows = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (edge(x, y) || rack(x, y) ? "#" : ".")).join(""));
  return parsePlan(rows.join("\n"));
}

/** Microseconds a run of `calls()`, which returns how many calls it made; A*'s nodes a call over them. */
function timeOf(calls) {
  resetTrace();
  const begin = performance.now();
  const made = calls();
  const ms = performance.now() - begin;
  const counters = traceSnapshot().counters.astar ?? {};
  return { us: Math.round((1000 * ms) / made) / 1, nodes: counters.calls ? Math.round(counters.expanded / counters.calls) : null };
}

/** Ten robots planned one after the other, parking at the end, then many paths around them; `direct`, the floor's way first. */
function warehouseCase(direct = false) {
  const plan = warehouse(40, 21);
  const rng = createRng(7);
  const open = plan.find(".");
  const table = createReservations();
  for (let unit = 0; unit < 10; unit += 1) {
    const found = astar(plan, open[rng.int(open.length)], open[rng.int(open.length)], { passable, reservations: table, unit, park: true, horizon: 80 });
    if (found) table.reserve(unit, found, { stay: true });
  }
  // An older library has no createDistances: the same calls, A* alone.
  const options = { passable, reservations: table, unit: "u", park: true, horizon: 80, ...(direct && grid.createDistances ? { direct: grid.createDistances(plan, passable) } : {}) };
  return timeOf(() => {
    for (let i = 0; i < 3000; i += 1) astar(plan, open[rng.int(open.length)], open[rng.int(open.length)], { ...options, start: rng.int(5) });
    return 3000;
  });
}

/** The kitchen's corridor: a cook shut in a dead end by two cooks parked for good, asking each turn. */
function deadEndCase() {
  const plan = parsePlan(["##############", "#..#.........#", "#..#.........#", "#.............#", "###############"].join("\n"));
  const table = createReservations();
  table.reserve("p", [{ x: 3, y: 3, t: 0 }], { stay: true });
  return timeOf(() => {
    for (let i = 0; i < 3000; i += 1) astar(plan, { x: 1, y: 1 }, { x: 12, y: 2 }, { passable, reservations: table, unit: "c", start: i % 7, horizon: 55 });
    return 3000;
  });
}

/** Short calls on a small kitchen: the cost a call carries whatever it explores. */
function shortCase() {
  const plan = warehouse(14, 9);
  const rng = createRng(3);
  const open = plan.find(".");
  const table = createReservations();
  return timeOf(() => {
    for (let i = 0; i < 20_000; i += 1) {
      const from = open[rng.int(open.length)];
      const near = open.filter((cell) => Math.abs(cell.x - from.x) + Math.abs(cell.y - from.y) <= 3);
      astar(plan, from, near[rng.int(near.length)], { passable, reservations: table, unit: "c" });
    }
    return 20_000;
  });
}

/** The table a search's world copies: ten paths held, cloned again and again. */
function cloneCase() {
  const plan = warehouse(40, 21);
  const rng = createRng(9);
  const open = plan.find(".");
  const table = createReservations();
  for (let unit = 0; unit < 10; unit += 1) {
    const found = astar(plan, open[rng.int(open.length)], open[rng.int(open.length)], { passable, reservations: table, unit, horizon: 80 });
    if (found) table.reserve(unit, found);
  }
  return timeOf(() => {
    for (let i = 0; i < 2000; i += 1) table.clone();
    return 2000;
  });
}

/** A search on common worlds whose drawing is the dear part, with the problem's copy and without. */
function commonCase(copy) {
  const heavy = (rng) => Array.from({ length: 400 }, () => rng.next());
  const problem = {
    sample: (state, rng) => ({ luck: heavy(rng), chosen: null }),
    actor: () => "me",
    moves: () => ["A", "B", "C", "D"],
    key: (move) => move,
    play: (world, move) => ({ ...world, chosen: move }),
    over: (world) => world.chosen !== null,
    rollout: (world) => world,
    score: (world) => 0.5 * world.luck[0] + 0.1 * "ABCD".indexOf(world.chosen) * 0.1,
    ...(copy ? { copy: (world) => ({ ...world, luck: world.luck.slice() }) } : {}),
  };
  return timeOf(() => {
    for (let seed = 1; seed <= 200; seed += 1) search({}, problem, { budget: 64, rng: createRng(seed), common: true });
    return 200;
  });
}

console.log(JSON.stringify({ source, warehouse: warehouseCase(), warehouseDirect: warehouseCase(true), deadEnd: deadEndCase(), short: shortCase(), clone: cloneCase(), common: commonCase(false), commonCopy: commonCase(true) }));

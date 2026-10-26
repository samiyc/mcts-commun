import { createEvents } from "./events.js";
import { count, timed, trace } from "./trace.js";

/**
 * Plans drawn as text and paths found on them (Sami, 22/10/2026: change the warehouse, the kitchen or the
 * hospital by changing a plan). A plan is lines of characters, one a cell; what a character means is the
 * project's business (its legend), the grid only knows which cells are passable.
 *
 * Several units move at once: a path is found in space and time (A* over (x, y, t), waiting allowed) against
 * a table of reservations, so that no two units hold the same cell at the same moment nor swap cells
 * between two moments. Units plan one after the other, each around the paths already reserved (cooperative
 * A*, Silver 2005).
 */

/** A plan from text: `{ width, height, at(x, y), inside(x, y), find(char), lines }`. Lines are padded with spaces. */
export function parsePlan(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  while (lines.length > 0 && lines.at(-1).trim() === "") lines.pop();
  const width = Math.max(0, ...lines.map((line) => line.length));
  const rows = lines.map((line) => line.padEnd(width, " "));
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < rows.length;
  return {
    width,
    height: rows.length,
    lines: rows,
    inside,
    at: (x, y) => (inside(x, y) ? rows[y][x] : null),
    /** Every cell holding `char`, row by row: `[{ x, y }]`. */
    find: (char) => rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === char ? [{ x, y }] : []))),
  };
}

const STEPS = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const cellKey = (x, y) => `${x},${y}`;

/**
 * Reservations of cells and moves in time, by unit: `reserve(unit, path, { stay })` holds each step of `path`
 * (`[{ x, y, t }]`) and each move between two steps, and with `stay` the last cell from then on;
 * `release(unit)` frees all of a unit's; `isFree(x, y, t, unit)`, `swaps(from, to, t, unit)`: may `unit` be
 * there at `t`, move from → to between `t` and `t + 1` without meeting a unit moving to → from?
 * `freeFrom(x, y, t, unit)`: may `unit` park there from `t` on, nobody else due there later?
 *
 * `shared` cells (a truck's dock, a doorway's far side) hold any number of units: nobody holds them, but a
 * move into or out of one is still reserved, so two units never cross on its edge.
 *
 * `clone()` copies the table, for a search that plays a world forward without touching the real one.
 */
export function createReservations({ shared = [] } = {}) {
  return tableOf({ sharedKeys: new Set(shared.map(({ x, y }) => cellKey(x, y))), cells: new Map(), byCell: new Map(), moves: new Map(), stays: new Map(), byUnit: new Map() });
}

const OVERBOOKED_TRACED = 20;
let overbookings = 0;
function overbooked(cell, unit, other) {
  count("grid", "overbooked");
  overbookings += 1;
  if (overbookings <= OVERBOOKED_TRACED) trace("grid", "warn", { message: "case réservée par-dessus une autre unité", cell, unit, other });
}

const moveKey = (from, to, t) => `${cellKey(from.x, from.y)}>${cellKey(to.x, to.y)}@${t}`;

/** The reservations' methods over their maps (createReservations, and each clone). */
function tableOf(maps) {
  return { ...bookingOf(maps), ...queriesOf(maps), clone: () => tableOf(copyOf(maps)) };
}

/** `reserve` and `release`: the maps written. */
function bookingOf(maps) {
  const { sharedKeys, byUnit } = maps;
  return {
    reserve(unit, path, { stay = false } = {}) {
      const kept = path.filter(({ x, y }) => !sharedKeys.has(cellKey(x, y)));
      const keys = holdCells(maps, unit, kept);
      const edges = holdMoves(maps, unit, path);
      byUnit.set(unit, { keys, steps: kept, edges, stay: parkAt(maps, unit, path.at(-1), stay) });
    },
    release(unit) {
      const held = byUnit.get(unit);
      if (!held) return;
      for (const key of held.keys) dropHeld(maps.cells, key, unit);
      for (const { x, y, t } of held.steps) dropHeld(maps.byCell.get(cellKey(x, y)), t, unit);
      for (const edge of held.edges) dropHeld(maps.moves, edge, unit);
      if (held.stay && maps.stays.get(held.stay)?.unit === unit) maps.stays.delete(held.stay);
      byUnit.delete(unit);
    },
  };
}

/** Holds each step of `kept` for `unit`, by cell and time: the keys held. */
function holdCells({ cells, byCell }, unit, kept) {
  const keys = kept.map(({ x, y, t }) => `${cellKey(x, y)},${t}`);
  // A cell booked over another unit is how two robots met (23/10): counted, and the first ones traced.
  for (const key of keys) {
    if (cells.has(key) && cells.get(key) !== unit) overbooked(key, unit, cells.get(key));
    cells.set(key, unit);
  }
  for (const { x, y, t } of kept) {
    if (!byCell.has(cellKey(x, y))) byCell.set(cellKey(x, y), new Map());
    byCell.get(cellKey(x, y)).set(t, unit);
  }
  return keys;
}

/** Holds each move of `path` (a wait is no move) for `unit`: the edges held. */
function holdMoves({ moves }, unit, path) {
  const edges = path.slice(1).flatMap((step, i) => (step.x === path[i].x && step.y === path[i].y ? [] : [moveKey(path[i], step, path[i].t)]));
  for (const edge of edges) moves.set(edge, unit);
  return edges;
}

/** Parks `unit` on `last` from its time on, unless it is shared: the cell parked on, or null. */
function parkAt({ sharedKeys, stays }, unit, last, stay) {
  if (!stay || !last || sharedKeys.has(cellKey(last.x, last.y))) return null;
  stays.set(cellKey(last.x, last.y), { unit, from: last.t });
  return cellKey(last.x, last.y);
}

const dropHeld = (map, key, unit) => {
  if (map?.get(key) === unit) map.delete(key);
};

/** `isFree`, `freeFrom` and `swaps`: the maps read. */
function queriesOf({ sharedKeys, cells, byCell, moves, stays }) {
  return {
    isFree(x, y, t, unit) {
      if (sharedKeys.has(cellKey(x, y))) return true;
      // A step and a stay are both checked: a unit planning again still holds its old steps, which must not hide
      // another unit parked there since (Sami's warehouse, 23/10: two robots met on a cell).
      const held = cells.get(`${cellKey(x, y)},${t}`);
      if (held !== undefined && held !== unit) return false;
      const stay = stays.get(cellKey(x, y));
      return !stay || t < stay.from || stay.unit === unit;
    },
    freeFrom(x, y, t, unit) {
      if (sharedKeys.has(cellKey(x, y))) return true;
      const stay = stays.get(cellKey(x, y));
      if (stay && stay.unit !== unit) return false;
      for (const [time, holder] of byCell.get(cellKey(x, y)) ?? []) if (time >= t && holder !== unit) return false;
      return true;
    },
    swaps(from, to, t, unit) {
      const other = moves.get(moveKey(to, from, t));
      return other !== undefined && other !== unit;
    },
  };
}

const copyOf = ({ sharedKeys, cells, byCell, moves, stays, byUnit }) => ({
  sharedKeys,
  cells: new Map(cells),
  byCell: new Map([...byCell].map(([key, times]) => [key, new Map(times)])),
  moves: new Map(moves),
  stays: new Map(stays),
  byUnit: new Map(byUnit),
});

/**
 * The shortest path in time from `from` to `to` (`{ x, y }`), leaving at `start`: `[{ x, y, t }]` from the start
 * to the arrival, waits included, or null. `passable(char, x, y)` says which cells a unit may enter;
 * `reservations` and `unit`, whose cells to avoid; `horizon`, how many steps to look ahead at most; `park`,
 * the unit stays at `to` once there, so it arrives only when nobody else is due there later.
 *
 * @param {{ passable: (char: string, x: number, y: number) => boolean, reservations?: object | null, unit?: any, start?: number, horizon?: number, park?: boolean }} options
 */
export function astar(plan, from, to, options) {
  // Traced (src/trace.js): counted and timed, the paths not found counted, a slow or failing call kept with its ends.
  const path = timed("astar", () => shortestPath(plan, from, to, options), () => ({ from, to, unit: options.unit ?? null, start: options.start ?? 0 }));
  if (!path) count("astar", "notFound");
  return path;
}

/** The search's settings: the options given, their defaults where left out. */
function settingsOf(plan, to, options) {
  const given = (name, fallback) => (options[name] === undefined ? fallback : options[name]);
  return { plan, to, passable: options.passable, reservations: given("reservations", null), unit: given("unit", null), start: given("start", 0), horizon: given("horizon", 4 * plan.width * plan.height), park: given("park", false) };
}

const distanceTo = (to, x, y) => Math.abs(x - to.x) + Math.abs(y - to.y);

function shortestPath(plan, from, to, options) {
  const settings = settingsOf(plan, to, options);
  const { reservations, unit, start, horizon, park } = settings;
  const arrived = (node) => node.x === to.x && node.y === to.y && (!park || !reservations || reservations.freeFrom(to.x, to.y, node.t, unit));
  // A consistent heuristic pops f in non-decreasing order: the event queue serves as the open list.
  const open = createEvents();
  const seen = new Set();
  open.schedule(distanceTo(to, from.x, from.y), { x: from.x, y: from.y, t: start, parent: null });
  for (let next = open.next(); next; next = open.next()) {
    const node = next.event;
    if (arrived(node)) return pathOf(node);
    const key = `${cellKey(node.x, node.y)},${node.t}`;
    if (seen.has(key) || node.t - start >= horizon) continue;
    seen.add(key);
    expand(node, settings, open);
  }
  return null;
}

/** Schedules every step `node` may take: a wait or a move to a passable cell, free then, swapping with nobody. */
function expand(node, settings, open) {
  for (const [dx, dy] of STEPS) {
    const step = { x: node.x + dx, y: node.y + dy, t: node.t + 1 };
    if (canStep(node, step, settings)) open.schedule(step.t - settings.start + distanceTo(settings.to, step.x, step.y), { ...step, parent: node });
  }
}

function canStep(node, { x, y, t }, { plan, passable, reservations, unit }) {
  if (!plan.inside(x, y) || !passable(plan.at(x, y), x, y)) return false;
  return !reservations || (reservations.isFree(x, y, t, unit) && !reservations.swaps(node, { x, y }, node.t, unit));
}

function pathOf(node) {
  const path = [];
  for (let step = node; step; step = step.parent) path.push({ x: step.x, y: step.y, t: step.t });
  return path.reverse();
}

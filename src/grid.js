import { createEvents } from "./events.js";

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
 */
export function createReservations({ shared = [] } = {}) {
  const sharedKeys = new Set(shared.map(({ x, y }) => cellKey(x, y)));
  const cells = new Map();
  const byCell = new Map();
  const moves = new Map();
  const stays = new Map();
  const byUnit = new Map();
  const holder = (x, y, t) => {
    const held = cells.get(`${cellKey(x, y)},${t}`);
    if (held !== undefined) return held;
    const stay = stays.get(cellKey(x, y));
    return stay && t >= stay.from ? stay.unit : undefined;
  };
  const moveKey = (from, to, t) => `${cellKey(from.x, from.y)}>${cellKey(to.x, to.y)}@${t}`;
  return {
    reserve(unit, path, { stay = false } = {}) {
      const kept = path.filter(({ x, y }) => !sharedKeys.has(cellKey(x, y)));
      const keys = kept.map(({ x, y, t }) => `${cellKey(x, y)},${t}`);
      for (const key of keys) cells.set(key, unit);
      for (const { x, y, t } of kept) {
        if (!byCell.has(cellKey(x, y))) byCell.set(cellKey(x, y), new Map());
        byCell.get(cellKey(x, y)).set(t, unit);
      }
      const edges = path.slice(1).flatMap((step, i) => (step.x === path[i].x && step.y === path[i].y ? [] : [moveKey(path[i], step, path[i].t)]));
      for (const edge of edges) moves.set(edge, unit);
      const last = path.at(-1);
      const parks = stay && last && !sharedKeys.has(cellKey(last.x, last.y));
      if (parks) stays.set(cellKey(last.x, last.y), { unit, from: last.t });
      byUnit.set(unit, { keys, steps: kept, edges, stay: parks ? cellKey(last.x, last.y) : null });
    },
    release(unit) {
      const held = byUnit.get(unit);
      if (!held) return;
      for (const key of held.keys) if (cells.get(key) === unit) cells.delete(key);
      for (const { x, y, t } of held.steps) if (byCell.get(cellKey(x, y))?.get(t) === unit) byCell.get(cellKey(x, y)).delete(t);
      for (const edge of held.edges) if (moves.get(edge) === unit) moves.delete(edge);
      if (held.stay && stays.get(held.stay)?.unit === unit) stays.delete(held.stay);
      byUnit.delete(unit);
    },
    isFree(x, y, t, unit) {
      if (sharedKeys.has(cellKey(x, y))) return true;
      const held = holder(x, y, t);
      return held === undefined || held === unit;
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

/**
 * The shortest path in time from `from` to `to` (`{ x, y }`), leaving at `start`: `[{ x, y, t }]` from the start
 * to the arrival, waits included, or null. `passable(char, x, y)` says which cells a unit may enter;
 * `reservations` and `unit`, whose cells to avoid; `horizon`, how many steps to look ahead at most; `park`,
 * the unit stays at `to` once there, so it arrives only when nobody else is due there later.
 */
export function astar(plan, from, to, { passable, reservations = null, unit = null, start = 0, horizon = 4 * plan.width * plan.height, park = false } = {}) {
  const arrived = (node) => node.x === to.x && node.y === to.y && (!park || !reservations || reservations.freeFrom(to.x, to.y, node.t, unit));
  const distance = (x, y) => Math.abs(x - to.x) + Math.abs(y - to.y);
  const free = (x, y, t) => !reservations || reservations.isFree(x, y, t, unit);
  // A consistent heuristic pops f in non-decreasing order: the event queue serves as the open list.
  const open = createEvents();
  const seen = new Set();
  open.schedule(distance(from.x, from.y), { x: from.x, y: from.y, t: start, parent: null });
  for (let next = open.next(); next; next = open.next()) {
    const node = next.event;
    if (arrived(node)) return pathOf(node);
    const key = `${cellKey(node.x, node.y)},${node.t}`;
    if (seen.has(key) || node.t - start >= horizon) continue;
    seen.add(key);
    for (const [dx, dy] of STEPS) {
      const x = node.x + dx;
      const y = node.y + dy;
      const t = node.t + 1;
      if (!plan.inside(x, y) || !passable(plan.at(x, y), x, y) || !free(x, y, t)) continue;
      if (reservations && reservations.swaps(node, { x, y }, node.t, unit)) continue;
      open.schedule(t - start + distance(x, y), { x, y, t, parent: node });
    }
  }
  return null;
}

function pathOf(node) {
  const path = [];
  for (let step = node; step; step = step.parent) path.push({ x: step.x, y: step.y, t: step.t });
  return path.reverse();
}

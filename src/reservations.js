import { count, trace } from "./trace.js";

/**
 * The table of reservations that units plan around (src/grid.js), out of grid.js when A* learnt to stop early
 * (27/10/2026, the lint's 220 lines).
 */

const cellKey = (x, y) => `${x},${y}`;

/**
 * Reservations of cells and moves in time, by unit: `reserve(unit, path, { stay })` holds each step of `path`
 * (`[{ x, y, t }]`) and each move between two steps, and with `stay` the last cell from then on;
 * `release(unit)` frees all of a unit's; `isFree(x, y, t, unit)`, `swaps(from, to, t, unit)`: may `unit` be
 * there at `t`, move from → to between `t` and `t + 1` without meeting a unit moving to → from?
 * `freeFrom(x, y, t, unit)`: may `unit` park there from `t` on, nobody else due there later? `stayAt(x, y)`: who is
 * parked there for good, and since when (`{ unit, from }`, null on a shared cell or a free one).
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
function overbooked(cell, unit, other, clone) {
  count("grid", "overbooked");
  if (clone) count("grid", "overbookedInClone");
  overbookings += 1;
  if (overbookings <= OVERBOOKED_TRACED) trace("grid", "warn", { message: "case réservée par-dessus une autre unité", cell, unit, other, clone });
}

const moveKey = (from, to, t) => `${cellKey(from.x, from.y)}>${cellKey(to.x, to.y)}@${t}`;

/** The reservations' methods over their maps (createReservations, and each clone). */
function tableOf(maps) {
  return { ...bookingOf(maps), ...queriesOf(maps), clone: () => tableOf({ ...copyOf(maps), cloned: true }) };
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
function holdCells({ cells, byCell, cloned = false }, unit, kept) {
  const keys = kept.map(({ x, y, t }) => `${cellKey(x, y)},${t}`);
  // A cell booked over another unit is how two robots met (23/10): counted, and the first ones traced, saying whether
  // a search's clone booked it or the world itself (27/10).
  for (const key of keys) {
    if (cells.has(key) && cells.get(key) !== unit) overbooked(key, unit, cells.get(key), cloned);
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

/** `isFree`, `freeFrom`, `swaps` and `stayAt`: the maps read. */
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
    stayAt(x, y) {
      return sharedKeys.has(cellKey(x, y)) ? null : (stays.get(cellKey(x, y)) ?? null);
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

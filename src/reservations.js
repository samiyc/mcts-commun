import { cellOf, checkCells, limitOf, moveOf, queriesOf } from "./reservations-query.js";
import { count, trace } from "./trace.js";

/**
 * The table of reservations that units plan around (src/grid.js), out of grid.js when A* learnt to stop early
 * (27/10/2026, the lint's 220 lines).
 */

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
 * `capacity` (the kitchen, 28/10/2026: two cooks pass each other in a 1.22 m aisle, a cell being about 1 m): how many
 * units a cell holds at one time, 1 by default; the `single` cells (where one works a station) hold one whatever it
 * is. Two units cross face to face between two cells that each hold two or more. Parking still wants a cell alone.
 *
 * `clone()` copies the table, for a search that plays a world forward without touching the real one.
 */
export function createReservations({ shared = [], capacity = 1, single = [] } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`capacity: un nombre entier d'unités, pas ${capacity}`);
  checkCells([...shared, ...single]);
  const keysOf = (cells) => new Set(cells.map(({ x, y }) => cellOf(x, y)));
  return tableOf({ sharedKeys: keysOf(shared), singleKeys: keysOf(single), capacity, byCell: new Map(), moves: new Map(), stays: new Map(), byUnit: new Map() });
}

const OVERBOOKED_TRACED = 20;
let overbookings = 0;
function overbooked(cell, unit, other, clone) {
  count("grid", "overbooked");
  if (clone) count("grid", "overbookedInClone");
  overbookings += 1;
  if (overbookings <= OVERBOOKED_TRACED) trace("grid", "warn", { message: "case réservée par-dessus une autre unité", cell, unit, other, clone });
}

/** The reservations' methods over their maps (createReservations, and each clone). */
function tableOf(maps) {
  return { ...bookingOf(maps), ...queriesOf(maps), clone: () => tableOf({ ...copyOf(maps), cloned: true }) };
}

/** `reserve` and `release`: the maps written. */
function bookingOf(maps) {
  const { sharedKeys, byUnit } = maps;
  return {
    reserve(unit, path, { stay = false } = {}) {
      checkCells(path);
      const kept = path.filter(({ x, y }) => !sharedKeys.has(cellOf(x, y)));
      holdCells(maps, unit, kept);
      const edges = holdMoves(maps, unit, path);
      byUnit.set(unit, { steps: kept, edges, stay: parkAt(maps, unit, path.at(-1), stay) });
    },
    release(unit) {
      const held = byUnit.get(unit);
      if (!held) return;
      for (const { x, y, t } of held.steps) dropUnit(maps.byCell.get(cellOf(x, y)), t, unit);
      for (const [edge, t] of held.edges) dropMove(maps.moves.get(t), edge, unit);
      if (held.stay !== null && maps.stays.get(held.stay)?.unit === unit) maps.stays.delete(held.stay);
      byUnit.delete(unit);
    },
  };
}

/** Holds each step of `kept` for `unit`, by cell and time. */
function holdCells(maps, unit, kept) {
  for (const { x, y, t } of kept) {
    const cell = cellOf(x, y);
    if (!maps.byCell.has(cell)) maps.byCell.set(cell, new Map());
    const times = maps.byCell.get(cell);
    times.set(t, joined(times.get(t), unit, limitOf(maps, cell), (other) => overbooked(`${x},${y},${t}`, unit, other, maps.cloned ?? false)));
  }
}

const NOBODY = Object.freeze([]);

/**
 * The units on a cell at one time once `unit` joins them, a new array (a clone shares the old one). A cell booked over
 * its capacity is how two robots met (23/10): counted, the first ones traced, saying whether a search's clone booked
 * it or the world itself (27/10), and the latest units keep it, as the one unit a cell held did.
 */
function joined(holders = NOBODY, unit, limit, onOver) {
  if (holders.includes(unit)) return holders;
  if (holders.length < limit) return [...holders, unit];
  onOver(holders.at(-1));
  return [...holders.slice(holders.length - limit + 1), unit];
}

/** `unit` off its cell at `t`, the others left there. */
function dropUnit(times, t, unit) {
  const holders = times?.get(t);
  if (!holders?.includes(unit)) return;
  const rest = holders.filter((holder) => holder !== unit);
  if (rest.length > 0) times.set(t, rest);
  else times.delete(t);
}

const dropMove = (edges, edge, unit) => {
  if (edges?.get(edge) === unit) edges.delete(edge);
};

/** Holds each move of `path` (a wait is no move) for `unit`: the edges held, `[move, t]`. */
function holdMoves({ moves }, unit, path) {
  const edges = path.slice(1).flatMap((step, i) => (step.x === path[i].x && step.y === path[i].y ? [] : [[moveOf(path[i], step), path[i].t]]));
  for (const [edge, t] of edges) {
    // By time, then by move: fewer maps for a clone to copy than one a move.
    if (!moves.has(t)) moves.set(t, new Map());
    moves.get(t).set(edge, unit);
  }
  return edges;
}

/** Parks `unit` on `last` from its time on, unless it is shared: the cell parked on, or null. */
function parkAt({ sharedKeys, stays }, unit, last, stay) {
  if (!stay || !last || sharedKeys.has(cellOf(last.x, last.y))) return null;
  stays.set(cellOf(last.x, last.y), { unit, from: last.t });
  return cellOf(last.x, last.y);
}

// The arrays of units are never changed in place: copying the maps is enough.
const copyOf = ({ sharedKeys, singleKeys, capacity, byCell, moves, stays, byUnit }) => ({
  sharedKeys,
  singleKeys,
  capacity,
  byCell: new Map([...byCell].map(([key, times]) => [key, new Map(times)])),
  moves: new Map([...moves].map(([t, edges]) => [t, new Map(edges)])),
  stays: new Map(stays),
  byUnit: new Map(byUnit),
});

/**
 * The keys of the reservations (src/reservations.js) and their queries, out of it when cells gained a capacity
 * (28/10/2026, the lint's 220 lines). Keys are numbers, not text (28/10/2026: the warehouse's profile, 6 to 9 % in
 * `isFree`, `swaps` and `holdMoves`): a cell is its two coordinates on 13 bits each, from −4096 to 4095; a move, the
 * cell it leaves then the one it enters, under 2⁵² so still exact; the moves are kept by time, then by move.
 */

const SIDE = 8192;
const HALF = SIDE / 2;
const CELLS = SIDE * SIDE;

export const cellOf = (x, y) => (y + HALF) * SIDE + (x + HALF);
export const moveOf = (from, to) => cellOf(from.x, from.y) * CELLS + cellOf(to.x, to.y);

/** Throws unless every step of `path` is a cell the keys can hold: integers from −4096 to 4095. */
export function checkCells(path) {
  const outside = path.find(({ x, y }) => !Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x + 0.5) > HALF || Math.abs(y + 0.5) > HALF);
  if (outside) throw new Error(`réservation hors des cases permises (−4096 à 4095) : ${outside.x},${outside.y}`);
}

/** How many units `cell` holds at once: any on a shared one, one on a `single` one, else the table's `capacity`. */
export function limitOf({ sharedKeys, singleKeys, capacity }, cell) {
  if (sharedKeys.has(cell)) return Infinity;
  return singleKeys.has(cell) ? 1 : capacity;
}

/** Two units may cross face to face between two cells that each hold two or more, shared ones left out. */
const crossable = (maps, cell) => maps.capacity >= 2 && !maps.sharedKeys.has(cell) && !maps.singleKeys.has(cell);

/** The units other than `unit` among `holders`. */
function othersIn(holders, unit) {
  let others = 0;
  for (const holder of holders) if (holder !== unit) others += 1;
  return others;
}

/** `isFree`, `freeFrom`, `swaps` and `stayAt`: the maps read. */
export function queriesOf(maps) {
  const { sharedKeys, byCell, moves, stays } = maps;
  return {
    isFree(x, y, t, unit) {
      const cell = cellOf(x, y);
      if (sharedKeys.has(cell)) return true;
      // A step and a stay are both checked: a unit planning again still holds its old steps, which must not hide
      // another unit parked there since (Sami's warehouse, 23/10: two robots met on a cell).
      const holders = byCell.get(cell)?.get(t);
      if (holders !== undefined && othersIn(holders, unit) >= limitOf(maps, cell)) return false;
      const stay = stays.get(cell);
      return !stay || t < stay.from || stay.unit === unit;
    },
    freeFrom(x, y, t, unit) {
      const cell = cellOf(x, y);
      if (sharedKeys.has(cell)) return true;
      // Parking wants the cell alone, whatever its capacity: nobody else due there later.
      const stay = stays.get(cell);
      if (stay && stay.unit !== unit) return false;
      for (const [time, holders] of byCell.get(cell) ?? []) if (time >= t && othersIn(holders, unit) > 0) return false;
      return true;
    },
    swaps(from, to, t, unit) {
      if (crossable(maps, cellOf(from.x, from.y)) && crossable(maps, cellOf(to.x, to.y))) return false;
      const other = moves.get(t)?.get(moveOf(to, from));
      return other !== undefined && other !== unit;
    },
    stayAt(x, y) {
      const cell = cellOf(x, y);
      return sharedKeys.has(cell) ? null : (stays.get(cell) ?? null);
    },
  };
}

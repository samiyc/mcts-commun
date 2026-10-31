import { parsePlan } from "../../src/grid.js";

/** The plans the tests and the bench share (bench/grid-search.js): the same cases, the same budgets. */

export const passable = (char) => char !== "#";

/** A warehouse: racks two cells deep in rows, aisles between them, a wall round. */
export function warehouse(width, height) {
  const edge = (x, y) => x === 0 || y === 0 || x === width - 1 || y === height - 1;
  const rack = (x, y) => y % 4 !== 0 && x % 6 >= 2 && x % 6 <= 3;
  return parsePlan(Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (edge(x, y) || rack(x, y) ? "#" : ".")).join("")).join("\n"));
}

/** The kitchen's corridor with its dead end: a cook shut in by a cook parked for good asks again each turn. */
export const CORRIDOR = parsePlan(["##############", "#..#.........#", "#..#.........#", "#.............#", "###############"].join("\n"));

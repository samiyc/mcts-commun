import { directPath } from "./grid-distances.js";
import { createOpen } from "./grid-open.js";
import { outOfReach } from "./grid-reach.js";
import { count, timed } from "./trace.js";

export { createDistances } from "./grid-distances.js";
export { createReservations } from "./reservations.js";

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
/**
 * The shortest path in time from `from` to `to` (`{ x, y }`), leaving at `start`: `[{ x, y, t }]` from the start
 * to the arrival, waits included, or null. `passable(char, x, y)` says which cells a unit may enter;
 * `reservations` and `unit`, whose cells to avoid; `horizon`, how many steps to look ahead at most; `park`,
 * the unit stays at `to` once there, so it arrives only when nobody else is due there later.
 *
 * A target walled off by units parked for good gives null without searching to the horizon (Sami, 27/10/2026: on the
 * kitchen's corridor one call in two found no path, 2.5 ms each against 0.07): the same answer, sooner. So does a
 * target further than the horizon, and a step from which the target can no longer be reached within it is never
 * taken: `horizon` is the furthest the unit may go. The target out of reach is asked once the search has explored
 * twice what a free path needs (28/10/2026: a unit shut in a dead end gave up only at the horizon), not the plan's size.
 *
 * Bounds for a bot short of time (Sami, 27/10/2026: CodinGame's 50 ms a turn): `maxNodes`, the cells-in-time explored
 * at most, null beyond (counted `capped`); `partial`, the path to the explored cell nearest the target rather than
 * null, when the search is capped or finds no way (counted `partial`; the horizon then cuts only by time).
 *
 * `direct` (28/10/2026, the kitchen's way): the floor's distances (`createDistances(plan, passable)`, kept by the
 * project with its plan); the path straight down them is taken when each of its steps is free and passable for this
 * call, A* searching only when one is not. The distances may come from a more permissive floor than the call's
 * `passable` (an aisle closed for one leg): still a shortest path then, A* taking over where the floor differs. A
 * shortest path, not always A*'s where two are as short: a project's fingerprints change.
 *
 * @param {{ passable: (char: string, x: number, y: number) => boolean, reservations?: object | null, unit?: any, start?: number, horizon?: number, park?: boolean, maxNodes?: number, partial?: boolean, direct?: { plan: object, to: (target: { x: number, y: number }) => Int32Array } }} options
 */
export function astar(plan, from, to, options) {
  // Traced (src/trace.js): counted and timed, the paths not found counted, a slow or failing call kept with its ends.
  const path = timed("astar", () => shortestPath(plan, from, to, options), () => ({ from, to, unit: options.unit ?? null, start: options.start ?? 0 }));
  if (!path) count("astar", "notFound");
  return path;
}

/** The search's settings: the options given, their defaults where left out; `reach`, the furthest an arrival may be. */
function settingsOf(plan, from, to, options) {
  const horizon = given(options.horizon, 4 * plan.width * plan.height);
  const partial = given(options.partial, false);
  const cells = plan.width * plan.height;
  // The target out of reach is asked once the search has explored twice what a free path needs (28/10/2026: a unit
  // shut in a dead end never reached the plan's size); with `partial`, at the plan's size, so its path stays the same.
  const checkAt = partial ? cells : Math.min(cells, 2 * (distanceTo(to, from.x, from.y) + 1) + 8);
  const bounds = { maxNodes: given(options.maxNodes, Infinity), partial, reach: partial ? Infinity : horizon, checkAt };
  const reservations = given(options.reservations, null);
  const scratch = { x: 0, y: 0 };
  return { plan, to, passable: options.passable, reservations, unit: given(options.unit, null), start: given(options.start, 0), horizon, park: given(options.park, false), ...bounds, cells, scratch };
}

const given = (value, fallback) => (value === undefined ? fallback : value);
const distanceTo = (to, x, y) => Math.abs(x - to.x) + Math.abs(y - to.y);

/** The path, its nodes explored counted once a call (`expanded / calls`: what a call costs). */
function shortestPath(plan, from, to, options) {
  const settings = settingsOf(plan, from, to, options);
  // With `direct` (createDistances), the floor's way first, when every step of it is free (counted `direct`).
  const straight = options.direct ? directPath(settings, from, options.direct) : null;
  if (straight) {
    count("astar", "direct");
    return straight;
  }
  const seen = new Set();
  const path = explore(settings, from, seen);
  count("astar", "expanded", seen.size);
  return path;
}

/** A* from `from`, each node explored kept in `seen`, by a number: its time from the start, then its cell. */
function explore(settings, from, seen) {
  const { plan, to, start, horizon, cells } = settings;
  const nearest = { node: null, distance: Infinity };
  if (distanceTo(to, from.x, from.y) > settings.reach) return short(settings, nearest, "givenUp");
  // A consistent heuristic pops f in non-decreasing order, equals in the order pushed, as the event queue did.
  const open = createOpen();
  open.push(distanceTo(to, from.x, from.y), nodeOf(from.x, from.y, start, null));
  for (let node = open.pop(); node; node = open.pop()) {
    if (arrived(settings, node)) return pathOf(node);
    const key = (node.t - start) * cells + node.y * plan.width + node.x;
    if (seen.has(key)) continue;
    // A node at the horizon is not explored, but a partial path may end there.
    closer(nearest, node, to);
    if (node.t - start >= horizon) continue;
    seen.add(key);
    const stop = stopAfter(settings, seen, from);
    if (stop) return short(settings, nearest, stop);
    expand(node, settings, open);
  }
  return short(settings, nearest, null);
}

/** A node of the open list, of one shape for V8: its cell, its time, where it came from, its `f` and order once pushed. */
const nodeOf = (x, y, t, parent) => ({ x, y, t, parent, f: 0, order: 0 });

const arrived = ({ to, park, reservations, unit }, node) => node.x === to.x && node.y === to.y && (!park || !reservations || reservations.freeFrom(to.x, to.y, node.t, unit));

/** Why the search stops once `seen` holds its latest node: "capped", "givenUp", or null to go on. */
function stopAfter(settings, seen, from) {
  if (seen.size > settings.maxNodes) return "capped";
  // A target out of reach is asked once (src/grid-reach.js): the same null A* would give, sooner.
  return seen.size === settings.checkAt && outOfReach(settings, from) ? "givenUp" : null;
}

/** Keeps in `nearest` the first node explored at the least distance from `to`. */
function closer(nearest, node, to) {
  const distance = distanceTo(to, node.x, node.y);
  if (distance >= nearest.distance) return;
  nearest.node = node;
  nearest.distance = distance;
}

/** A search ended without arriving (`why`, a counter, or null when no way was left): null, or the partial path. */
function short({ partial }, nearest, why) {
  if (why) count("astar", why);
  if (!partial || !nearest.node) return null;
  count("astar", "partial");
  return pathOf(nearest.node);
}

/**
 * Pushes every step `node` may take: a wait or a move to a passable cell, free then, swapping with nobody, from which
 * the target can still be reached in time. A node is made only for a step allowed.
 */
function expand(node, settings, open) {
  const t = node.t + 1;
  for (const [dx, dy] of STEPS) {
    const x = node.x + dx;
    const y = node.y + dy;
    const arrival = t - settings.start + distanceTo(settings.to, x, y);
    if (arrival <= settings.reach && canStep(node, x, y, settings)) open.push(arrival, nodeOf(x, y, t, node));
  }
}

/** May a unit on `node` be on (x, y) one step later? */
function canStep(node, x, y, { plan, passable, reservations, unit, scratch }) {
  if (!plan.inside(x, y) || !passable(plan.at(x, y), x, y)) return false;
  if (!reservations) return true;
  if (!reservations.isFree(x, y, node.t + 1, unit)) return false;
  scratch.x = x;
  scratch.y = y;
  return !reservations.swaps(node, scratch, node.t, unit);
}

function pathOf(node) {
  const path = [];
  for (let step = node; step; step = step.parent) path.push({ x: step.x, y: step.y, t: step.t });
  return path.reverse();
}

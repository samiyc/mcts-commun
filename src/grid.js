import { createEvents } from "./events.js";
import { count, timed } from "./trace.js";

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
const cellKey = (x, y) => `${x},${y}`;

/**
 * The shortest path in time from `from` to `to` (`{ x, y }`), leaving at `start`: `[{ x, y, t }]` from the start
 * to the arrival, waits included, or null. `passable(char, x, y)` says which cells a unit may enter;
 * `reservations` and `unit`, whose cells to avoid; `horizon`, how many steps to look ahead at most; `park`,
 * the unit stays at `to` once there, so it arrives only when nobody else is due there later.
 *
 * A target walled off by units parked for good gives null without searching to the horizon (Sami, 27/10/2026: on the
 * kitchen's corridor one call in two found no path, 2.5 ms each against 0.07): the same answer, sooner. So does a
 * target further than the horizon, and a step from which the target can no longer be reached within it is never
 * taken: `horizon` is the furthest the unit may go.
 *
 * Bounds for a bot short of time (Sami, 27/10/2026: CodinGame's 50 ms a turn): `maxNodes`, the cells-in-time explored
 * at most, null beyond (counted `capped`); `partial`, the path to the explored cell nearest the target rather than
 * null, when the search is capped or finds no way (counted `partial`; the horizon then cuts only by time).
 *
 * @param {{ passable: (char: string, x: number, y: number) => boolean, reservations?: object | null, unit?: any, start?: number, horizon?: number, park?: boolean, maxNodes?: number, partial?: boolean }} options
 */
export function astar(plan, from, to, options) {
  // Traced (src/trace.js): counted and timed, the paths not found counted, a slow or failing call kept with its ends.
  const path = timed("astar", () => shortestPath(plan, from, to, options), () => ({ from, to, unit: options.unit ?? null, start: options.start ?? 0 }));
  if (!path) count("astar", "notFound");
  return path;
}

/** The search's settings: the options given, their defaults where left out; `reach`, the furthest an arrival may be. */
function settingsOf(plan, to, options) {
  const given = (name, fallback) => (options[name] === undefined ? fallback : options[name]);
  const horizon = given("horizon", 4 * plan.width * plan.height);
  const partial = given("partial", false);
  const bounds = { maxNodes: given("maxNodes", Infinity), partial, reach: partial ? Infinity : horizon };
  return { plan, to, passable: options.passable, reservations: given("reservations", null), unit: given("unit", null), start: given("start", 0), horizon, park: given("park", false), ...bounds };
}

const distanceTo = (to, x, y) => Math.abs(x - to.x) + Math.abs(y - to.y);

/** The path, its nodes explored counted once a call (`expanded / calls`: what a call costs). */
function shortestPath(plan, from, to, options) {
  const settings = settingsOf(plan, to, options);
  const seen = new Set();
  const path = explore(settings, from, seen);
  count("astar", "expanded", seen.size);
  return path;
}

/** A* from `from`, each node explored kept in `seen`. */
function explore(settings, from, seen) {
  const { to, start, horizon } = settings;
  const nearest = { node: null, distance: Infinity };
  if (distanceTo(to, from.x, from.y) > settings.reach) return short(settings, nearest, "givenUp");
  // A consistent heuristic pops f in non-decreasing order: the event queue serves as the open list.
  const open = createEvents();
  open.schedule(distanceTo(to, from.x, from.y), { x: from.x, y: from.y, t: start, parent: null });
  for (let next = open.next(); next; next = open.next()) {
    const node = next.event;
    if (arrived(settings, node)) return pathOf(node);
    const key = `${cellKey(node.x, node.y)},${node.t}`;
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

const arrived = ({ to, park, reservations, unit }, node) => node.x === to.x && node.y === to.y && (!park || !reservations || reservations.freeFrom(to.x, to.y, node.t, unit));

/** Why the search stops once `seen` holds its latest node: "capped", "givenUp", or null to go on. */
function stopAfter(settings, seen, from) {
  if (seen.size > settings.maxNodes) return "capped";
  // Once the search has seen as many nodes as the plan has cells, a target out of reach is likely: checked once.
  return seen.size === settings.plan.width * settings.plan.height && outOfReach(settings, from) ? "givenUp" : null;
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

/** Schedules every step `node` may take: a wait or a move to a passable cell, free then, swapping with nobody, from which the target can still be reached in time. */
function expand(node, settings, open) {
  for (const [dx, dy] of STEPS) {
    const step = { x: node.x + dx, y: node.y + dy, t: node.t + 1 };
    const arrival = step.t - settings.start + distanceTo(settings.to, step.x, step.y);
    if (arrival <= settings.reach && canStep(node, step, settings)) open.schedule(arrival, { ...step, parent: node });
  }
}

/**
 * Can `to` be reached within the horizon at all? A lower bound on the arrival: the cells where another unit is
 * parked for good are walls from the time it parks (`isFree` is false there from then on), the steps of the units
 * on the move left out. A path in time keeps to it, so none when it is out of reach, or when the unit must park
 * where another already is (`freeFrom` is false there for good).
 */
function outOfReach({ plan, to, passable, reservations, unit, start, horizon, park }, from) {
  // Without reservations, the walls alone (27/10/2026: a walled target, 217 ms at horizon 80 on a 40 × 20 plan).
  const parkedAt = (x, y) => {
    const stay = reservations ? reservations.stayAt(x, y) : null;
    return stay === null || stay.unit === unit ? Infinity : stay.from;
  };
  if (park && parkedAt(to.x, to.y) !== Infinity) return true;
  const enters = (x, y, t) => plan.inside(x, y) && passable(plan.at(x, y), x, y) && t < parkedAt(x, y);
  const seen = new Set([cellKey(from.x, from.y)]);
  let layer = [from];
  for (let t = start; layer.length > 0 && t - start <= horizon; t += 1) {
    if (layer.some((cell) => cell.x === to.x && cell.y === to.y)) return false;
    const around = layer.flatMap((cell) => STEPS.slice(1).map(([dx, dy]) => ({ x: cell.x + dx, y: cell.y + dy })));
    // Each cell enters one layer once: marked as it enters, or two neighbours both add it and the layers grow
    // fourfold a step (27/10/2026: 4 s at horizon 20 on a 40 × 20 plan, minutes at 80).
    layer = around.filter(({ x, y }) => {
      if (seen.has(cellKey(x, y)) || !enters(x, y, t + 1)) return false;
      seen.add(cellKey(x, y));
      return true;
    });
  }
  return true;
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

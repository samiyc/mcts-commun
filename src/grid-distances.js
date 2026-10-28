/**
 * Floor distances and the direct path along them (the kitchen's, 28/10/2026: its directPath and its distances kept by
 * cell made its search two to four times faster). A leg whose shortest way is free needs no A*: it follows the floor's
 * distances down to the target, and A* plans only when a step there is taken. The floor never changes in a plan, so
 * the distances to a target are kept once found.
 */

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * The floor's distances on `plan`, by target: `to({ x, y })` gives an Int32Array of the steps from each cell
 * (`y × width + x`) to the target, −1 where it cannot be reached; computed once a target, then kept. The project keeps
 * this object with its plan and hands it to `astar` as `direct`.
 *
 * @returns {{ plan: object, to: (target: { x: number, y: number }) => Int32Array }}
 */
export function createDistances(plan, passable) {
  const known = new Map();
  return {
    plan,
    to(target) {
      const key = target.y * plan.width + target.x;
      if (!known.has(key)) known.set(key, floodFrom(plan, passable, target));
      return known.get(key);
    },
  };
}

/** Steps to `target` from each passable cell, breadth first from the target. */
function floodFrom(plan, passable, target) {
  const { width } = plan;
  const steps = new Int32Array(width * plan.height).fill(-1);
  if (!plan.inside(target.x, target.y)) return steps;
  const queue = [target.y * width + target.x];
  steps[queue[0]] = 0;
  for (let i = 0; i < queue.length; i += 1) {
    const x0 = queue[i] % width;
    const y0 = (queue[i] - x0) / width;
    for (const [dx, dy] of SIDES) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (!plan.inside(x, y) || steps[y * width + x] !== -1 || !passable(plan.at(x, y), x, y)) continue;
      steps[y * width + x] = steps[queue[i]] + 1;
      queue.push(y * width + x);
    }
  }
  return steps;
}

/**
 * The path straight down the floor's distances from `from` to the settings' target, leaving at `start`, no wait: null
 * when it is longer than the horizon, when a step is taken (another unit's cell, a swap), or when the unit must park
 * and the target is not free from the arrival on. A shortest path in time, as A*'s, but not always the same one where
 * two are as short. Each step takes the first side nearer the target that is free, as the kitchen's did.
 */
export function directPath(settings, from, distances) {
  const { plan, to, start, reservations, unit, park } = settings;
  const steps = stepsFrom(settings, from, distances);
  if (!steps) return null;
  const left = steps[from.y * plan.width + from.x];
  const path = [{ x: from.x, y: from.y, t: start }];
  for (let toward = left - 1; toward >= 0; toward -= 1) {
    const next = stepDown(settings, path.at(-1), steps, toward);
    if (!next) return null;
    path.push(next);
  }
  if (park && reservations && !reservations.freeFrom(to.x, to.y, path.at(-1).t, unit)) return null;
  return path;
}

/** The distances to the target when `from` reaches it within the horizon, else null. */
function stepsFrom({ plan, to, horizon }, from, distances) {
  if (distances.plan !== plan || !plan.inside(from.x, from.y)) return null;
  const steps = distances.to(to);
  const left = steps[from.y * plan.width + from.x];
  return left >= 0 && left <= horizon ? steps : null;
}

/** The first side of `cell` at `toward` steps from the target that the unit may step on next. */
function stepDown({ plan, reservations, unit }, cell, steps, toward) {
  for (const [dx, dy] of SIDES) {
    const next = { x: cell.x + dx, y: cell.y + dy, t: cell.t + 1 };
    if (!plan.inside(next.x, next.y) || steps[next.y * plan.width + next.x] !== toward) continue;
    if (!reservations || (reservations.isFree(next.x, next.y, next.t, unit) && !reservations.swaps(cell, next, cell.t, unit))) return next;
  }
  return null;
}

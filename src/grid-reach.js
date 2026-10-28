/**
 * Whether a target is out of reach before A* searches to its horizon (src/grid.js), out of grid.js when it learnt to
 * ask early (28/10/2026: the warehouse's failed calls cost 29 to 34 % of its A* time, the kitchen's dead ends 55
 * nodes a call). A flood over the plan's cells, layer by layer, on typed arrays kept from one call to the next: the
 * warehouse's own filter paid only once it allocated nothing (Int32Array buffers, a stamp a call).
 */

let marks = new Int32Array(0);
let layer = new Int32Array(0);
let next = new Int32Array(0);
let stamp = 0;

/** The buffers for a plan of `cells` cells, and this call's stamp: a cell is seen when its mark holds it. */
function stampFor(cells) {
  if (marks.length < cells) {
    marks = new Int32Array(cells);
    layer = new Int32Array(cells);
    next = new Int32Array(cells);
    stamp = 0;
  }
  stamp += 1;
  if (stamp === 0x7fffffff) {
    marks.fill(0);
    stamp = 1;
  }
  return stamp;
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Can `to` be reached within the horizon at all? A lower bound on the arrival: the cells where another unit is
 * parked for good are walls from the time it parks (`isFree` is false there from then on), the steps of the units
 * on the move left out. A path in time keeps to it, so none when it is out of reach, or when the unit must park
 * where another already is (`freeFrom` is false there for good). A start off the plan is never said out of reach.
 */
export function outOfReach(settings, from) {
  const { plan, to, park } = settings;
  const parkedAt = parkedOf(settings);
  if (park && parkedAt(to.x, to.y) !== Infinity) return true;
  if (!plan.inside(from.x, from.y)) return false;
  return !flood({ settings, parkedAt, seen: stampFor(plan.width * plan.height) }, from);
}

/** Whether the flood from `from` meets the target within the horizon. */
function flood(fill, from) {
  const { plan, to, start, horizon } = fill.settings;
  const target = plan.inside(to.x, to.y) ? to.y * plan.width + to.x : -1;
  layer[0] = from.y * plan.width + from.x;
  marks[layer[0]] = fill.seen;
  let size = 1;
  for (let t = start; size > 0 && t - start <= horizon; t += 1) {
    for (let i = 0; i < size; i += 1) if (layer[i] === target) return true;
    size = spread(fill, size, t + 1);
    [layer, next] = [next, layer];
  }
  return false;
}

/** When a cell turns into a wall: the time another unit parks there for good, else Infinity. */
function parkedOf({ reservations, unit }) {
  // Without reservations, the walls alone (27/10/2026: a walled target, 217 ms at horizon 80 on a 40 × 20 plan).
  if (!reservations) return () => Infinity;
  return (x, y) => {
    const stay = reservations.stayAt(x, y);
    return stay === null || stay.unit === unit ? Infinity : stay.from;
  };
}

/**
 * Fills `next` with the cells the layer's `size` cells lead to at `t`, each once: marked as it enters, or two
 * neighbours both add it and the layers grow fourfold a step (27/10/2026: 4 s at horizon 20 on a 40 × 20 plan).
 */
function spread({ settings, parkedAt, seen }, size, t) {
  const { plan, passable } = settings;
  const { width } = plan;
  let count = 0;
  for (let i = 0; i < size; i += 1) {
    const x0 = layer[i] % width;
    const y0 = (layer[i] - x0) / width;
    for (const [dx, dy] of NEIGHBOURS) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (!plan.inside(x, y) || marks[y * width + x] === seen) continue;
      if (!passable(plan.at(x, y), x, y) || t >= parkedAt(x, y)) continue;
      marks[y * width + x] = seen;
      next[count] = y * width + x;
      count += 1;
    }
  }
  return count;
}

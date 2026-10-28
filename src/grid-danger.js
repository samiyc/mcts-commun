/**
 * Danger in time on a grid, an option beside `astar` (Sami, 28/10/2026: two tricks of his Legend bot of Hypersonic,
 * 2016, read again by mcts-codingame, docs/anciens-bots.md; "rather specific to a bomberman, but one never knows").
 * `dangerTimeline`: for each cell the first turn it is deadly, from sources that go off after a delay along straight
 * lines, chains included. `escapeRoutes`: for each first step, how many turns until a cell no danger reaches again; the
 * bot's "lay a bomb only if a way out exists after" is the same, the new bomb among the sources. Pure; no `node:*`.
 */

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const MOVES = [[0, 0], ...SIDES];

/** The cells a source's blast reaches, `y × width + x`: its own, then each side up to `range`, cut where it stops. */
function blastOf(plan, { x, y, range, sides = SIDES }, { blocks, absorbs }) {
  const cells = [y * plan.width + x];
  for (const [dx, dy] of sides) {
    for (let k = 1; k <= range; k += 1) {
      const [cx, cy] = [x + dx * k, y + dy * k];
      if (!plan.inside(cx, cy) || blocks(plan.at(cx, cy), cx, cy)) break;
      cells.push(cy * plan.width + cx);
      if (absorbs(plan.at(cx, cy), cx, cy)) break;
    }
  }
  return cells;
}

/** Each source's delay once the chains are in: a source a blast reaches goes off with it, until no delay moves. */
function chained(sources, blasts, plan) {
  const delays = sources.map((source) => source.delay);
  const at = new Map();
  sources.forEach(({ x, y }, j) => at.set(y * plan.width + x, [...(at.get(y * plan.width + x) ?? []), j]));
  for (let moved = true; moved; ) {
    moved = false;
    blasts.forEach((cells, i) => {
      for (const j of cells.flatMap((cell) => at.get(cell) ?? [])) {
        if (delays[i] >= delays[j]) continue;
        delays[j] = delays[i];
        moved = true;
      }
    });
  }
  return delays;
}

/**
 * The first turn each cell of `plan` is deadly, from `sources` `[{ x, y, delay, range, sides? }]`: a source goes off
 * `delay` turns from now, on its cell and `range` cells along each of its `sides` (the four by default). A blast stops
 * before a cell `blocks(char, x, y)` says (a wall), and after one `absorbs` says (a box, an item, another bomb: hit,
 * then stopped). A source another's blast reaches goes off with it (`chain`, true by default), by fixed point.
 * `{ at, until, delays }`: by `y × width + x`, the first and the last turn a blast reaches each cell (Int32Arrays, −1
 * where none does), and each source's delay, chains in. Between a cell's first and last blast, `escapeRoutes` counts
 * it deadly: prudent, as a bot needs.
 */
export function dangerTimeline(plan, sources, { blocks = () => false, absorbs = () => false, chain = true } = {}) {
  const blasts = sources.map((source) => blastOf(plan, source, { blocks, absorbs }));
  const delays = chain ? chained(sources, blasts, plan) : sources.map((source) => source.delay);
  const at = new Int32Array(plan.width * plan.height).fill(-1);
  const until = new Int32Array(plan.width * plan.height).fill(-1);
  blasts.forEach((cells, i) => {
    for (const cell of cells) {
      if (at[cell] < 0 || delays[i] < at[cell]) at[cell] = delays[i];
      until[cell] = Math.max(until[cell], delays[i]);
    }
  });
  return { at, until, delays };
}

/** The first turn `cell` stays safe after its last blast's `burn` turns of fire: 0 where nothing reaches. */
const calmFrom = ({ until }, cell, burn) => (until[cell] < 0 ? 0 : until[cell] + burn);
const deadly = ({ at, until }, cell, t, burn) => at[cell] >= 0 && t >= at[cell] && t < until[cell] + burn;

/** One turn on: the first moves that reach each cell alive at `t`, as a bit each in `masks`. */
function stepOn(plan, masks, t, { danger, burn, passable }) {
  const next = new Uint8Array(masks.length);
  masks.forEach((mask, cell) => {
    if (!mask) return;
    const [x, y] = [cell % plan.width, Math.floor(cell / plan.width)];
    for (const [dx, dy] of MOVES) {
      const [nx, ny] = [x + dx, y + dy];
      const to = ny * plan.width + nx;
      // Staying is always allowed (a unit may stand on the bomb it laid); entering asks `passable`.
      if ((dx || dy) && (!plan.inside(nx, ny) || !passable(plan.at(nx, ny), nx, ny))) continue;
      if (!deadly(danger, to, t, burn)) next[to] |= mask;
    }
  });
  return next;
}

/** The first moves (`MOVES`' order) that reach each cell alive one turn from `from`, as one bit each. */
function firstLayer(plan, from, { danger, burn, passable }) {
  const masks = new Uint8Array(plan.width * plan.height);
  MOVES.forEach(([dx, dy], m) => {
    const [x, y] = [from.x + dx, from.y + dy];
    if ((dx || dy) && (!plan.inside(x, y) || !passable(plan.at(x, y), x, y))) return;
    if (!deadly(danger, y * plan.width + x, 1, burn)) masks[y * plan.width + x] |= 1 << m;
  });
  return masks;
}

/**
 * For each first step from `from` (stay, then right, left, down, up), the turns until the unit stands on a cell no
 * danger reaches any more, waiting allowed on the way: `[{ dx, dy, steps }]`, `steps` −1 when every way from that step
 * dies. `danger` is what `dangerTimeline` returns; a cell burns `burn` turns (1); `passable(char, x, y)` says where a
 * unit may step. Stay is 0 when `from` is safe already.
 */
export function escapeRoutes(plan, from, { danger, passable, burn = 1 }) {
  const options = { danger, burn, passable };
  const steps = MOVES.map(() => -1);
  if (calmFrom(danger, from.y * plan.width + from.x, burn) === 0) steps[0] = 0;
  const end = danger.until.reduce((most, turn) => Math.max(most, turn), 1) + burn;
  let masks = firstLayer(plan, from, options);
  for (let t = 1; t <= end && steps.includes(-1); t += 1) {
    masks.forEach((mask, cell) => {
      if (!mask || calmFrom(danger, cell, burn) > t) return;
      MOVES.forEach((_, m) => {
        if (mask & (1 << m) && steps[m] < 0) steps[m] = t;
      });
    });
    masks = stepOn(plan, masks, t + 1, options);
  }
  return MOVES.map(([dx, dy], m) => ({ dx, dy, steps: steps[m] }));
}

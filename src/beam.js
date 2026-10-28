import { createStatePool } from "./pool.js";

/**
 * A beam search over a turn's own moves, allocating nothing once created (codingame, 28/10/2026: Hypersonic v2, a
 * beam of 14 turns over 120 states, 1st in 77 % of 4-player games against Sami's Legend bot; the library had none).
 * The same algorithm as Hypersonic's, in the same order, so that a bot moved onto it plays the same orders:
 * - each state of the beam tries every action, its child a copy of it the problem plays (`play`: the gain, NaN when
 *   the action cannot be played or the child is cut);
 * - a child's reward is its parent's plus the gain faded `fade^depth`, its score that reward plus `value`;
 * - the same state reached twice (`hash`) is kept once, the better score in its place;
 * - the `width` best children become the beam (a quickselect, Hoare's partition, the better first);
 * - the deadline is read before each parent: a layer cut short is dropped, the last full one decides.
 *
 * What a bot keeps a node goes in bytes of its state. The result is one object, rewritten by each run.
 */

/** The smallest power of two at least `n`. */
const powerOf2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

function createLayer(size, capacity, Type) {
  return { states: createStatePool(size, capacity, Type).states, reward: new Float64Array(capacity), score: new Float64Array(capacity), first: new Int32Array(capacity), count: 0 };
}

/** Node `from` of layer `a` into node `to` of layer `b`: state, reward, score, first action. */
function copyNode(a, from, b, to) {
  b.states[to].set(a.states[from]);
  b.reward[to] = a.reward[from];
  b.score[to] = a.score[from];
  b.first[to] = a.first[from];
}

/** Keeps child `n` unless the same state is already in the layer with a better score (then the better stays). */
function keep({ children, seen }, n, h) {
  let slot = (h >>> 0) % seen.size;
  while (seen.stamp[slot] === seen.now && seen.key[slot] !== h) slot = (slot + 1) % seen.size;
  if (seen.stamp[slot] !== seen.now) {
    seen.stamp[slot] = seen.now;
    seen.key[slot] = h;
    seen.slot[slot] = n;
    children.count += 1;
    return;
  }
  const old = seen.slot[slot];
  if (children.score[n] > children.score[old]) copyNode(children, n, children, old);
}

/** Hoare's partition of `order[lo..hi]` around the score at its middle, the better first: `bounds` where it split. */
function partition({ order, children, bounds }, lo, hi) {
  const score = children.score;
  const pivot = score[order[(lo + hi) >> 1]];
  let i = lo;
  let j = hi;
  while (i <= j) {
    while (score[order[i]] > pivot) i += 1;
    while (score[order[j]] < pivot) j -= 1;
    if (i > j) break;
    const swap = order[i];
    order[i++] = order[j];
    order[j--] = swap;
  }
  bounds.i = i;
  bounds.j = j;
}

/** Moves the `k` best of `order[0..n)` to its front (by the children's score): a quickselect. */
function selectBest(beam, n, k) {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    partition(beam, lo, hi);
    if (k - 1 <= beam.bounds.j) hi = beam.bounds.j;
    else if (k - 1 >= beam.bounds.i) lo = beam.bounds.i;
    else return;
  }
}

/** Plays action `a` from beam state `i` into the next free child, kept if it lives. */
function tryAction(beam, i, a) {
  const { layer, children, problem, depth } = beam;
  const n = children.count;
  const child = children.states[n];
  child.set(layer.states[i]);
  const gain = problem.play(layer.states[i], child, a, depth);
  if (Number.isNaN(gain)) return;
  children.reward[n] = layer.reward[i] + gain * beam.faded;
  children.score[n] = children.reward[n] + problem.value(child, depth);
  children.first[n] = depth === 1 ? a : layer.first[i];
  if (problem.hash) keep(beam, n, problem.hash(child));
  else children.count += 1;
}

/** The next layer from the beam: false if the deadline cut it short. */
function expand(beam, deadline, now) {
  beam.children.count = 0;
  beam.seen.now += 1;
  for (let i = 0; i < beam.layer.count; i += 1) {
    if (now() > deadline) return false;
    for (let a = 0; a < beam.actions; a += 1) tryAction(beam, i, a);
  }
  return true;
}

/** The best children become the beam. */
function prune(beam) {
  const { children, layer, order } = beam;
  for (let n = 0; n < children.count; n += 1) order[n] = n;
  const kept = Math.min(beam.width, children.count);
  selectBest(beam, children.count, kept);
  for (let i = 0; i < kept; i += 1) copyNode(children, order[i], layer, i);
  layer.count = kept;
}

/** The best of the beam into the result: its first action and score, the first of equals. */
function best({ layer, result }) {
  let top = 0;
  for (let i = 1; i < layer.count; i += 1) if (layer.score[i] > layer.score[top]) top = i;
  result.first = layer.first[top];
  result.score = layer.score[top];
}

function reset({ layer, result }, root) {
  layer.states[0].set(root);
  layer.count = 1;
  layer.reward[0] = 0;
  layer.score[0] = 0;
  layer.first[0] = 0;
  result.first = -1;
  result.score = 0;
  result.depth = 0;
  result.states = 0;
}

const clock = () => globalThis.performance.now();

function runBeam(beam, root, problem, { depth, deadline = Infinity, fade = 1, now = clock }) {
  reset(beam, root);
  beam.problem = problem;
  const { result } = beam;
  for (beam.depth = 1; beam.depth <= depth; beam.depth += 1) {
    beam.faded = fade ** beam.depth;
    if (!expand(beam, deadline, now) || beam.children.count === 0) break;
    result.states += beam.children.count;
    prune(beam);
    best(beam);
    result.depth = beam.depth;
  }
  beam.problem = null;
  return result;
}

/**
 * @typedef {object} BeamProblem
 * @property {(parent: any, child: any, action: number, depth: number) => number} play  plays `action` on `child`, a
 *   copy of `parent`, at `depth` (1 the first turn): the gain, NaN to drop the child
 * @property {(state: any, depth: number) => number} value  what a state reached is worth beyond its rewards
 * @property {(state: any) => number} [hash]  a 32-bit key: states of the same key are one (none: no merging)
 */

/**
 * A beam of `width` states of `size` numbers (`Type`, Uint8Array by default), each trying `actions` actions;
 * `table`: the size of the table of states seen, a power of two at least twice the children by default. Its
 * `run(root, problem, { depth, deadline, fade, now })` searches a turn (`now`: performance.now by default) and
 * returns `{ first, score, depth, states }`: the best plan's first action (-1 if no child lives), its score, the
 * last full layer, the children kept over all layers. The same object each run: copy what you keep.
 *
 * @param {{ size: number, width: number, actions: number, Type?: any, table?: number }} shape
 */
export function createBeam({ size, width, actions, Type = Uint8Array, table = powerOf2(2 * width * actions) }) {
  const beam = {
    width,
    actions,
    layer: createLayer(size, width, Type),
    children: createLayer(size, width * actions, Type),
    seen: { size: table, key: new Int32Array(table), slot: new Int32Array(table), stamp: new Uint32Array(table), now: 0 },
    order: new Int32Array(width * actions),
    bounds: { i: 0, j: 0 },
    result: { first: -1, score: 0, depth: 0, states: 0 },
    problem: /** @type {BeamProblem | null} */ (null),
    depth: 0,
    faded: 1,
  };
  return {
    size,
    width,
    actions,
    /** @param {ArrayLike<number>} root @param {BeamProblem} problem @param {{ depth: number, deadline?: number, fade?: number, now?: () => number }} options */
    run: (root, problem, options) => runBeam(beam, root, problem, options),
  };
}

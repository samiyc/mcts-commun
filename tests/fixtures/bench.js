import { createRng } from "../../src/random.js";

/**
 * The bench's problems (bench/beam-climb.js), shared with tests/budget.test.js: the coin game of the beam, the plan of
 * numbers of the climb, and the beam written with objects, which allocates as a bot's first version would.
 */

export const SIDE = 13;
export const SIZE = 4 + Math.ceil((SIDE * SIDE) / 8);
const STEPS_X = Int8Array.of(0, -1, 1, 0, 0);
const STEPS_Y = Int8Array.of(0, 0, 0, -1, 1);

const rng = createRng(29);
const coins = Uint8Array.from({ length: SIDE * SIDE }, () => (rng.next() < 0.3 ? 1 + rng.int(9) : 0));
export const root = new Uint8Array(SIZE);
root[0] = 6;
root[1] = 5;

const taken = (s, cell) => (s[4 + (cell >> 3)] >> (cell & 7)) & 1;

/** A coin game allocating nothing: a step (or a step and a "bomb", actions 5-9, which only costs a little). */
export const coinGame = {
  play(parent, child, action) {
    const x = parent[0] + STEPS_X[action % 5];
    const y = parent[1] + STEPS_Y[action % 5];
    if (x < 0 || y < 0 || x >= SIDE || y >= SIDE) return NaN;
    child[0] = x;
    child[1] = y;
    child[2] += 1;
    const cell = y * SIDE + x;
    const bomb = action >= 5 ? -0.01 : 0;
    if (taken(child, cell) || coins[cell] === 0) return bomb;
    child[4 + (cell >> 3)] |= 1 << (cell & 7);
    return coins[cell] + bomb;
  },
  value(s) {
    let near = 0;
    for (let cell = 0; cell < SIDE * SIDE; cell += 1) if (coins[cell] && !taken(s, cell)) near += coins[cell] / (1 + Math.abs((cell % SIDE) - s[0]) + Math.abs(Math.floor(cell / SIDE) - s[1]));
    return 0.1 * near;
  },
  hash(s) {
    let h = 2166136261;
    for (let k = 0; k < SIZE; k += 1) h = Math.imul(h ^ s[k], 16777619);
    return h;
  },
};

/** Node's child by action `a` into the layer's `seen`, as objects: the better of a key stays. */
function offer(seen, node, a, d) {
  const state = Uint8Array.from(node.state);
  const gain = coinGame.play(node.state, state, a);
  if (Number.isNaN(gain)) return;
  const reward = node.reward + gain * 0.95 ** d;
  const child = { state, reward, score: reward + coinGame.value(state), first: d === 1 ? a : node.first };
  const old = seen.get(coinGame.hash(state));
  if (!old || child.score > old.score) seen.set(coinGame.hash(state), child);
}

/** The same beam with objects: a node an object, a Map a layer, a full sort. */
export function objectBeam(width, depth) {
  let beam = [{ state: root, reward: 0, score: 0, first: 0 }];
  for (let d = 1; d <= depth; d += 1) {
    const seen = new Map();
    for (const node of beam) for (let a = 0; a < 10; a += 1) offer(seen, node, a, d);
    beam = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, width);
  }
  return beam[0].first;
}

export const GENES = 24;
const target = Float64Array.from({ length: GENES }, (_, k) => Math.sin(k) * 100);

/** A plan of 24 numbers climbed towards a target: Mad Pod Racing's shape, a score that costs next to nothing. */
export const climbing = {
  start: (plan) => plan.fill(0),
  score(plan) {
    let sum = 0;
    for (let k = 0; k < GENES; k += 1) sum -= (plan[k] - target[k]) ** 2;
    return sum;
  },
  mutate(child, best, amplitude, draws) {
    child.set(best);
    for (let i = 0, n = 1 + draws.int(3); i < n; i += 1) child[draws.int(GENES)] += (draws.next() * 2 - 1) * amplitude * 50;
  },
  fresh(plan, draws) {
    for (let k = 0; k < GENES; k += 1) plan[k] = draws.next() * 200 - 100;
  },
  shift(next, last, draws) {
    next.set(last.subarray(4));
    for (let k = GENES - 4; k < GENES; k += 1) next[k] = draws.next() * 200 - 100;
  },
};

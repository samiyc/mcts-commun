import { PerformanceObserver, performance } from "node:perf_hooks";
import { createBeam } from "../src/beam.js";
import { createClimb } from "../src/climb.js";
import { createRng } from "../src/random.js";

/**
 * What the beam and the climb cost a turn, and how often the garbage collector runs meanwhile (Sami, 29/10/2026:
 * "limit the garbage collector's calls for the online version"; codingame, 28/10: a turn of objects let it push turns
 * to 45-72 ms of 75 on CodinGame). `node bench/beam-climb.js [TURNS]` plays TURNS turns (300 by default) of:
 * - the beam of Hypersonic's shape (120 states, 10 actions, 14 turns deep) on a small game of coins;
 * - the same beam written with objects and a sort a layer, as a bot's first version would be;
 * - a climb of Mad Pod Racing's shape (24 genes): 1 500 plans a turn, then 2 ms a turn with the clock read at every
 *   plan, then every 8 plans (`clockEvery`: performance.now() allocates its number).
 * One line of JSON: milliseconds and plans a turn, and the collections (minor and major) during the turns, after a
 * warm-up.
 * Beside the queue, under `mcts-backlog --slot 1`.
 */
const TURNS = Number(process.argv[2] ?? 300);
const SIDE = 13;
const SIZE = 4 + Math.ceil((SIDE * SIDE) / 8);
const STEPS_X = Int8Array.of(0, -1, 1, 0, 0);
const STEPS_Y = Int8Array.of(0, 0, 0, -1, 1);

const rng = createRng(29);
const coins = Uint8Array.from({ length: SIDE * SIDE }, () => (rng.next() < 0.3 ? 1 + rng.int(9) : 0));
const root = new Uint8Array(SIZE);
root[0] = 6;
root[1] = 5;

const taken = (s, cell) => (s[4 + (cell >> 3)] >> (cell & 7)) & 1;

/** A coin game allocating nothing: a step (or a step and a "bomb", actions 5-9, which only costs a little). */
const problem = {
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
  const gain = problem.play(node.state, state, a);
  if (Number.isNaN(gain)) return;
  const reward = node.reward + gain * 0.95 ** d;
  const child = { state, reward, score: reward + problem.value(state), first: d === 1 ? a : node.first };
  const old = seen.get(problem.hash(state));
  if (!old || child.score > old.score) seen.set(problem.hash(state), child);
}

/** The same beam with objects: a node an object, a Map a layer, a full sort. */
function objectBeam(width, depth) {
  let beam = [{ state: root, reward: 0, score: 0, first: 0 }];
  for (let d = 1; d <= depth; d += 1) {
    const seen = new Map();
    for (const node of beam) for (let a = 0; a < 10; a += 1) offer(seen, node, a, d);
    beam = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, width);
  }
  return beam[0].first;
}

const GENES = 24;
const target = Float64Array.from({ length: GENES }, (_, k) => Math.sin(k) * 100);
const climbing = {
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

// The collections, counted for the turns being measured only (the observer's entries come in after them).
let counting = null;
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) if (counting) counting[/** @type {any} */ (entry).detail?.kind === 1 ? "minor" : "major"] += 1;
});
observer.observe({ entryTypes: ["gc"] });
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

/** Milliseconds a turn of `turn()` (its plans a turn, if it says), and the collections meanwhile, after 50 turns of warm-up. */
async function measure(turn) {
  for (let i = 0; i < 50; i += 1) turn();
  await settle();
  const gc = { minor: 0, major: 0 };
  counting = gc;
  let plans = 0;
  const begun = performance.now();
  for (let i = 0; i < TURNS; i += 1) plans += turn()?.evaluations ?? 0;
  const ms = (performance.now() - begun) / TURNS;
  await settle();
  counting = null;
  return { msTurn: Math.round(ms * 1000) / 1000, ...(plans ? { plansTurn: Math.round(plans / TURNS) } : {}), gc };
}

const beam = createBeam({ size: SIZE, width: 120, actions: 10 });
const climb = createClimb({ genes: GENES });
const draws = createRng(2017);
const options = { depth: 14, fade: 0.95 };
const climbOptions = { budget: 1500, rng: draws };
const timed = { deadline: 0, rng: draws, clockEvery: 1 };
/** A turn of the climb given 2 ms, the clock read every `every` plans. */
const climbFor = (every) => () => {
  timed.clockEvery = every;
  timed.deadline = performance.now() + 2;
  return climb.run(climbing, timed);
};
const results = {
  beam: await measure(() => beam.run(root, problem, options)),
  objectBeam: await measure(() => objectBeam(120, 14)),
  climb: await measure(() => climb.run(climbing, climbOptions)),
  climb2msClock1: await measure(climbFor(1)),
  climb2msClock8: await measure(climbFor(8)),
};
observer.disconnect();
console.log(JSON.stringify({ turns: TURNS, ...results }));

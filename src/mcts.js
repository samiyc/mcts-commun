import { createRng } from "./random.js";

/**
 * A tree search over hidden information (single-observer ISMCTS, Cowling, Powley & Whitehouse 2012): the
 * scheme of Lopin's bot (lopin/src/sim/mcts/ismcts.js), with the game taken out. A problem (`Problem`,
 * below) says what the search may know and do; the search knows nothing else.
 *
 * Every iteration draws a world consistent with what is known (`sample`: a determinization, a scenario),
 * walks the tree on the moves that world allows, the fast rule's best few (`shortlist`), choosing by UCB1,
 * adds the first move not tried yet, then plays the fast rule to the end (`rollout`). Each move on the way
 * is credited with the score its own actor gets (`score(world, actor)`): a robot, the human, an opponent.
 * The moves a node offers depend on the world drawn, so a child's exploration term counts the iterations
 * where it was available, not its parent's visits. The tree stops at `depth` plies; the root plays its most
 * visited move. Moves are matched across worlds by `key`.
 *
 * @typedef {object} Problem
 * @property {(state, rng) => World} sample        a scenario consistent with what is known
 * @property {(world) => string} actor             who decides now: a robot, the human, an opponent
 * @property {(world) => Move[]} moves             the legal decisions at this event
 * @property {(world, moves) => Move[]} [shortlist] the fast rule's best few (all of them by default)
 * @property {(move) => string} key                a move's name, shared by every scenario
 * @property {(world, move) => World} play         applies the move, runs to the next decision
 * @property {(world) => boolean} over
 * @property {(world, rng) => World} rollout       the fast rule to the end
 * @property {(world, actor) => number} score      the reward of a finished world, 0 to 1
 */
export const SEARCH = Object.freeze({ depth: 5, explore: 0.7 });

const createNode = (move, key, actor) => ({ move, key, actor, visits: 0, total: 0, available: 0, children: new Map() });
const meanOf = (node) => (node.visits > 0 ? node.total / node.visits : 0);

/** The moves the search considers in `world`, by key, in the shortlist's order. */
function candidates(problem, world) {
  const moves = problem.moves(world);
  const kept = problem.shortlist ? problem.shortlist(world, moves) : moves;
  return new Map(kept.map((move) => [problem.key(move), move]));
}

/** UCB1 on availability among the children `offered` allows. */
function select(node, offered, explore) {
  let best = null;
  let bestValue = -Infinity;
  for (const child of node.children.values()) {
    if (!offered.has(child.key)) continue;
    const value = meanOf(child) + explore * Math.sqrt(Math.log(child.available) / child.visits);
    if (value > bestValue) {
      best = child;
      bestValue = value;
    }
  }
  return best;
}

/** One step down from `node` in `world`: the child added (`fresh`) or chosen, and the world after its move. */
function step(node, world, { problem, explore }) {
  const offered = candidates(problem, world);
  if (offered.size === 0) return null;
  for (const child of node.children.values()) if (offered.has(child.key)) child.available += 1;
  const untried = [...offered.keys()].find((key) => !node.children.has(key));
  if (untried !== undefined) {
    const child = createNode(offered.get(untried), untried, problem.actor(world));
    child.available = 1;
    node.children.set(untried, child);
    return { child, world: problem.play(world, child.move), fresh: true };
  }
  const child = select(node, offered, explore);
  return { child, world: problem.play(world, offered.get(child.key)), fresh: false };
}

/** Credits every move of `path` with its actor's score in the finished world. */
function backpropagate(root, path, end, problem) {
  const scores = new Map();
  const scoreOf = (actor) => {
    if (!scores.has(actor)) scores.set(actor, problem.score(end, actor));
    return scores.get(actor);
  };
  root.visits += 1;
  for (const node of path) {
    node.visits += 1;
    node.total += scoreOf(node.actor);
  }
}

/** One iteration: a world drawn, the walk down the tree, one move added, the rollout, the credit. */
function iterate(root, state, settings) {
  const { problem, rng, depth } = settings;
  let world = problem.sample(state, rng);
  let node = root;
  const path = [];
  for (let ply = 0; ply < depth && !problem.over(world); ply += 1) {
    const next = step(node, world, settings);
    if (!next) break;
    ({ child: node, world } = next);
    path.push(node);
    if (next.fresh) break;
  }
  const end = problem.over(world) ? world : problem.rollout(world, rng);
  backpropagate(root, path, end, problem);
}

const sizeOf = (node) => 1 + [...node.children.values()].reduce((sum, child) => sum + sizeOf(child), 0);

/**
 * Searches `state` for `budget` iterations. Returns the move to play (the root child most visited, the
 * better mean between equals; null when there is none), its mean score (`value`), each root move's visits
 * by key, every root move's `{ key, move, visits, mean }` from the most visited, and the tree's `size` in
 * nodes. A root move's object is the one of the world where it was first tried.
 *
 * @returns {{ move: Move | null, value: number, visits: Map<string, number>, stats: object[], size: number }}
 */
export function search(state, problem, { budget, rng = createRng(1), depth = SEARCH.depth, explore = SEARCH.explore }) {
  if (!Number.isInteger(budget) || budget < 1) throw new Error(`budget: a whole number of iterations, not ${budget}`);
  const root = createNode(null, "", "");
  const settings = { problem, rng, depth, explore };
  for (let i = 0; i < budget; i += 1) iterate(root, state, settings);
  const stats = [...root.children.values()]
    .map((child) => ({ key: child.key, move: child.move, visits: child.visits, mean: meanOf(child) }))
    .sort((a, b) => b.visits - a.visits || b.mean - a.mean);
  return {
    move: stats[0]?.move ?? null,
    value: stats[0]?.mean ?? 0,
    visits: new Map(stats.map((one) => [one.key, one.visits])),
    stats,
    size: sizeOf(root),
  };
}

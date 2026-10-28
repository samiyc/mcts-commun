import { createRng, streamOf } from "./random.js";
import { hintsOf, meanOf, resultOf } from "./search-report.js";
import { count, timed, trace } from "./trace.js";

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
 * @typedef {import("./types.js").World} World
 * @typedef {import("./types.js").Move} Move
 * @typedef {object} Problem
 * @property {(state, rng) => World} sample        a scenario consistent with what is known
 * @property {(world) => string} actor             who decides now: a robot, the human, an opponent
 * @property {(world) => Move[]} moves             the legal decisions at this event
 * @property {(world, moves, where: { root: boolean }) => Move[]} [shortlist] the fast rule's best few (all of them by
 *   default); `root` true at the root, so that a problem may keep more moves there than below (Sami, 28/10/2026)
 * @property {(move) => string} key                a move's name, shared by every scenario
 * @property {(world, move) => World} play         applies the move, runs to the next decision
 * @property {(world) => boolean} over
 * @property {(world, rng) => World} rollout       the fast rule to the end
 * @property {(world, actor) => number} score      the reward of a finished world, 0 to 1
 * @property {(world) => World} [copy]           a faithful copy: on common worlds, each is drawn once, then copied
 */
export const SEARCH = Object.freeze({ depth: 5, explore: 0.7 });

/** What a `Problem` must and may hold: the contract the README states and `tests/api.test.js` pins. */
export const PROBLEM = Object.freeze({
  required: Object.freeze(["sample", "actor", "moves", "key", "play", "over", "rollout", "score"]),
  optional: Object.freeze(["shortlist", "copy"]),
});

/** Throws, naming them, when `problem` lacks a function the search needs or holds a non-function in its place. */
export function checkProblem(problem) {
  const missing = PROBLEM.required.filter((name) => typeof problem?.[name] !== "function");
  const wrong = PROBLEM.optional.filter((name) => problem?.[name] !== undefined && typeof problem[name] !== "function");
  if (missing.length > 0 || wrong.length > 0) throw new Error(`Problem incomplet : ${[...missing, ...wrong].join(", ")}`);
  return problem;
}

const createNode = (move, key, actor) => ({ move, key, actor, visits: 0, total: 0, available: 0, children: new Map() });

/** The moves the search considers in `world`, by key, in the shortlist's order; `root` at the root. */
function candidates(problem, world, root = false) {
  const moves = problem.moves(world);
  const kept = problem.shortlist ? problem.shortlist(world, moves, { root }) : moves;
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

/**
 * Progressive widening below the root (Lopin's, 15/10/2026, the one variant it kept: lopin/src/sim/mcts/widening.js):
 * a node offers the first ⌊widening + √visits⌋ of the shortlist, so its first visits go deeper instead of wider.
 */
function widened(offered, node, widening) {
  if (!widening) return offered;
  return new Map([...offered].slice(0, Math.max(1, Math.floor(widening + Math.sqrt(node.visits)))));
}

/** One step down from `node` in `world` (`atRoot`: never widened): the child added (`fresh`) or chosen, and the world after its move. */
function step(node, world, { problem, explore, widening }, atRoot) {
  const offered = widened(candidates(problem, world, atRoot), node, atRoot ? 0 : widening);
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

/**
 * Credits every move of `path` with its actor's score in the finished world. A root move also keeps each score, in
 * order: its k-th is that of the k-th world on common worlds, so two root moves compare by pairs (`margin`).
 */
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
  const [first] = path;
  if (!first) return;
  first.scores ??= [];
  first.scores.push(scoreOf(first.actor));
}

/** One iteration: a world drawn, the walk down the tree, one move added, the rollout, the credit. */
function iterate(root, state, settings) {
  const { problem, rng, depth } = settings;
  let world = problem.sample(state, rng);
  let node = root;
  const path = [];
  for (let ply = 0; ply < depth && !problem.over(world); ply += 1) {
    const next = step(node, world, settings, ply === 0);
    if (!next) break;
    ({ child: node, world } = next);
    path.push(node);
    if (next.fresh) break;
  }
  const end = problem.over(world) ? world : problem.rollout(world, rng);
  backpropagate(root, path, end, problem);
}

/** What common worlds need: their streams' base, and the root's moves and actor, read in the first world. */
function commonRoot(state, problem, rng) {
  const base = Math.floor(rng.next() * 2 ** 32) >>> 0;
  const stream = streamOf(base, 0);
  const world = problem.sample(state, stream);
  // With `copy`, the k-th world is kept as drawn, with its stream's state just after: the first one is this one.
  const worlds = problem.copy ? [{ world, state: stream.getState() }] : null;
  return { base, worlds, moves: problem.over(world) ? new Map() : candidates(problem, world, true), actor: problem.actor(world) };
}

/**
 * The k-th common world, on `stream` (`streamOf(base, k)`). Drawn each time, or with `copy` (urgences, 28/10/2026: the
 * k-th world was drawn once a root move, the same each time) drawn once and copied, the stream put back where the
 * draw left it: the same world, the same random numbers after, so the same search.
 */
function commonWorld(state, { problem, common }, k, stream) {
  if (!common.worlds) return problem.sample(state, stream);
  const kept = common.worlds[k];
  if (kept) {
    stream.setState(kept.state);
    return problem.copy(kept.world);
  }
  const world = problem.sample(state, stream);
  common.worlds[k] = { world: problem.copy(world), state: stream.getState() };
  return world;
}

/** The root's child to visit: the first untried one in the shortlist's order, else UCB1 on the root's visits. */
function rootChild(root, common, explore) {
  for (const [key, move] of common.moves) {
    if (root.children.has(key)) continue;
    const child = createNode(move, key, common.actor);
    root.children.set(key, child);
    return child;
  }
  let best = null;
  let bestValue = -Infinity;
  for (const child of root.children.values()) {
    const value = meanOf(child) + explore * Math.sqrt(Math.log(root.visits) / child.visits);
    if (value > bestValue) {
      best = child;
      bestValue = value;
    }
  }
  return best;
}

/**
 * One iteration on common worlds: the root's child is chosen first, and its k-th visit plays the search's
 * k-th world, drawn and rolled out with the k-th random stream. Every root move is judged on the same worlds,
 * by pairs, which takes the worlds' own noise out of their comparison (Lopin's CommonDeals). Below the root,
 * the walk goes on as usual.
 */
function iterateCommon(root, state, settings) {
  const { problem, depth, explore, common } = settings;
  const child = rootChild(root, common, explore);
  const stream = streamOf(common.base, child.visits);
  let world = commonWorld(state, settings, child.visits, stream);
  const move = candidates(problem, world, true).get(child.key);
  if (!move) {
    trace("search", "error", { message: `coup ${child.key} manquant en common`, visit: child.visits });
    throw new Error(`common: le coup ${child.key} manque dans un monde ; les coups de la racine doivent être connus`);
  }
  world = problem.play(world, move);
  let node = child;
  const path = [child];
  for (let ply = 1; ply < depth && !problem.over(world); ply += 1) {
    const next = step(node, world, settings, false);
    if (!next) break;
    ({ child: node, world } = next);
    path.push(node);
    if (next.fresh) break;
  }
  const end = problem.over(world) ? world : problem.rollout(world, stream);
  backpropagate(root, path, end, problem);
}

/**
 * Searches `state` for `budget` iterations. Returns the move to play (the root child most visited, the
 * better mean between equals; null when there is none), its mean score (`value`), each root move's visits
 * by key, every root move's `{ key, move, visits, mean }` from the most visited, and the tree's `size` in
 * nodes. A root move's object is the one of the world where it was first tried. And what the search saw
 * (27/10/2026), read once it is done: the `iterations` run, the deepest level reached (`depth`), the nodes of each
 * level (`levels`), the `ms` spent, why it `stopped` (`budget`, `deadline`, `settled` by `earlyStop`, `empty`), and the
 * `margin` of its move over the next most visited with its 95 % interval (by pairs on common worlds); `diagnose`
 * reads them.
 *
 * `common`: judge the root's moves on common worlds (`iterateCommon`), when the root's moves are known in
 * every world and the worlds' noise dwarfs the moves' differences (a whole shift, a whole day to come). With the
 * problem's `copy`, each world is drawn once and kept, as many as the most visited root move's visits.
 *
 * `deadline` (Sami, 27/10/2026: a CodinGame bot has 50 ms a turn, not a number of iterations): iterate until
 * `now()` reaches it, `budget` then optional and a cap; at least one iteration, so a move comes back even late.
 * `now` is `performance.now` unless given (a test's clock). Without `deadline`, nothing changes.
 *
 * `widening` (27/10/2026): below the root, a node offers the first ⌊widening + √visits⌋ of its shortlist (`widened`).
 * `earlyStop`: with a `budget`, stop once the most visited root move leads by more than the iterations left: the
 * same move, sooner (Lopin's `smart`). Both off by default: the same moves and visits.
 *
 * @returns {{ move: Move | null, value: number, visits: Map<string, number>, stats: object[], size: number, iterations: number, depth: number, levels: number[], ms: number, stopped: string, margin: object | null, rank: { played: number, of: number } | null }}
 */
export function search(state, problem, { budget, deadline, now = clock, rng = createRng(1), depth = SEARCH.depth, explore = SEARCH.explore, common = false, widening = 0, earlyStop = false }) {
  // Traced (src/trace.js): counted and timed; an error or a slow search kept with its settings.
  const limit = { budget, deadline, now, earlyStop };
  const shape = { depth, explore, common, widening };
  return timed("search", () => searchTree(state, problem, { limit, rng, ...shape }), () => ({ budget, deadline, earlyStop, ...shape }));
}

/** What `search`'s result says of the problem searched, asked at `depth`: `[{ code, message }]` (src/search-report.js). */
export function diagnose(result, { depth = SEARCH.depth } = {}) {
  return hintsOf(result, depth);
}

const clock = () => globalThis.performance.now();

/** Throws unless `budget` is a whole number of iterations, or absent with a `deadline` to stop the search. */
function checkLimit({ budget, deadline }) {
  if (budget === undefined && Number.isFinite(deadline)) return;
  if (!Number.isInteger(budget) || budget < 1) throw new Error(`budget: a whole number of iterations, not ${budget}`);
}

function searchTree(state, problem, { limit, rng, depth, explore, common, widening }) {
  checkLimit(limit);
  checkProblem(problem);
  // Real time, not `now`: a test's clock counts its own ticks.
  const begin = clock();
  const root = createNode(null, "", "");
  const settings = { problem, rng, depth, explore, widening };
  if (common) settings.common = commonRoot(state, problem, rng);
  const { iterations, stopped } = iterateAll(root, state, settings, limit);
  count("search", "iterations", iterations);
  return resultOf(root, { iterations, ms: clock() - begin, stopped, common: Boolean(common) });
}

/**
 * Iterates up to `budget` and until `deadline`, on common worlds when asked (none when the root has no move
 * known in every world), with `earlyStop` until the root's leader is settled: how many iterations it ran, and why it
 * stopped (`budget`, `deadline`, `settled`; `empty` with no move to judge).
 */
function iterateAll(root, state, settings, limit) {
  if (settings.common?.moves.size === 0) return { iterations: 0, stopped: "empty" };
  const once = settings.common ? iterateCommon : iterate;
  const stops = stopsOf(root, limit);
  let done = 0;
  let stopped = null;
  do {
    once(root, state, settings);
    done += 1;
    stopped = stops(done);
  } while (!stopped);
  return { iterations: done, stopped };
}

/** Why the search stops after `done` iterations, or null: its budget spent, its deadline passed, its leader settled. */
function stopsOf(root, { budget = Infinity, deadline, now, earlyStop }) {
  const late = deadline === undefined ? () => false : () => now() >= deadline;
  const sure = earlyStop && Number.isFinite(budget) ? (done) => settled(root, budget - done) : () => false;
  return (done) => (done >= budget && "budget") || (late() && "deadline") || (sure(done) && "settled") || null;
}

/** Whether the most visited root move leads the next by more than `left` iterations: nobody can catch it. */
function settled(root, left) {
  let first = 0;
  let second = 0;
  for (const { visits } of root.children.values()) {
    if (visits > first) [first, second] = [visits, first];
    else if (visits > second) second = visits;
  }
  return first - second > left;
}

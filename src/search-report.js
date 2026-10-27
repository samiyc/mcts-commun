/**
 * What a search saw, read from its tree once it is done (Sami, 27/10/2026: hints to improve a bot without weighing
 * down the library): the result `search` returns, and `hintsOf`, what that result says about the problem searched.
 * Nothing here runs during the iterations; Lopin read the same from its trees (lopin/src/sim/mcts/tree-stats.js).
 */
import { paired } from "./measure.js";

export const meanOf = (node) => (node.visits > 0 ? node.total / node.visits : 0);

/** The tree under `root`: its nodes, the size of each level (the root's children are level 1), the deepest level. */
export function treeOf(root) {
  const levels = [];
  for (let layer = [...root.children.values()]; layer.length > 0; layer = layer.flatMap((node) => [...node.children.values()])) levels.push(layer.length);
  return { size: 1 + levels.reduce((sum, nodes) => sum + nodes, 0), depth: levels.length, levels };
}

const Z95 = 1.96;
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
/** A sample's variance; a quarter (the most a score between 0 and 1 can have) under two scores. */
function varianceOf(values) {
  if (values.length < 2) return 0.25;
  const mean = average(values);
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

/**
 * How far the move played leads the next most visited, with its 95 % interval (27/10/2026: the three projects found
 * `closeCall`'s bound p(1 − p) said "close" on almost every decision). On common worlds the k-th scores of both are
 * on the same world: by pairs (`paired`, src/measure.js), the worlds' noise taken out. Else on their own worlds, each
 * with its measured variance. Null under two moves.
 */
export function marginOf(first, second, common) {
  if (!first || !second) return null;
  const [a, b] = [first.scores ?? [], second.scores ?? []];
  if (common) {
    const n = Math.min(a.length, b.length);
    const { mean, low, high } = paired(a.slice(0, n), b.slice(0, n));
    return { mean, low, high, n, paired: true };
  }
  const mean = (a.length ? average(a) : 0) - (b.length ? average(b) : 0);
  const spread = Z95 * Math.sqrt(varianceOf(a) / Math.max(a.length, 1) + varianceOf(b) / Math.max(b.length, 1));
  return { mean, low: mean - spread, high: mean + spread, n: a.length + b.length, paired: false };
}

/**
 * What `search` returns, read from the root's children: the move to play (the most visited, the better mean between
 * equals), its mean, each root move's visits and `{ key, move, visits, mean }` from the most visited; the tree's
 * `size`, `depth` and `levels`; the `iterations` run, the `ms` they took, why the search `stopped`, and the move's
 * `margin` over the next.
 */
export function resultOf(root, { iterations, ms, stopped, common }) {
  const children = [...root.children.values()].sort((a, b) => b.visits - a.visits || meanOf(b) - meanOf(a));
  const stats = children.map((child) => ({ key: child.key, move: child.move, visits: child.visits, mean: meanOf(child) }));
  const tree = treeOf(root);
  return {
    move: stats[0]?.move ?? null,
    value: stats[0]?.mean ?? 0,
    visits: new Map(stats.map((one) => [one.key, one.visits])),
    stats,
    size: tree.size,
    iterations,
    depth: tree.depth,
    levels: tree.levels,
    ms,
    stopped,
    margin: marginOf(children[0], children[1], common),
  };
}

const PER_MOVE = 20;
const percent = (mean) => `${Math.round(100 * mean)} %`;

function fewIterations({ iterations, stats, stopped }) {
  const per = Math.floor(iterations / stats.length);
  // A search earlyStop ended had its move settled: few iterations then is the saving, not a fault.
  if (per >= PER_MOVE || stopped === "settled") return null;
  return { code: "fewIterations", message: `${per} itérations par coup de la racine (moins de ${PER_MOVE}) : un rollout plus rapide, une shortlist plus courte ou plus de temps` };
}

function flatScore({ stats }) {
  const means = stats.map((one) => one.mean);
  if (Math.max(...means) - Math.min(...means) >= 0.001) return null;
  return { code: "flatScore", message: `tous les coups de la racine valent ${percent(means[0])} : le score ne les départage pas, une récompense graduée (un retard, une marge) plutôt qu'un 0 ou 1` };
}

const points = (value) => `${value >= 0 ? "+" : "−"}${Math.abs(Math.round(100 * value))}`;

function closeCall({ stats, margin }) {
  if (!margin || margin.low > 0 || margin.high < 0) return null;
  const [first, second] = stats;
  const how = margin.paired ? `par paires sur ${margin.n} mondes communs` : `sur ${margin.n} mondes`;
  const gap = `écart ${points(margin.mean)} points (${points(margin.low)} à ${points(margin.high)}, ${how})`;
  const advice = margin.paired ? "plus d'itérations" : "des mondes communs (common) ou plus d'itérations";
  return { code: "closeCall", message: `les deux premiers coups (${first.key} ${percent(first.mean)}, ${second.key} ${percent(second.mean)}) se valent : ${gap} ; le choix est un tirage, ${advice}` };
}

function shallow({ depth: reached }, depth) {
  if (reached >= depth) return null;
  return { code: "shallow", message: `l'arbre s'arrête au niveau ${reached} sur ${depth} : si le problème va plus loin, l'élargissement progressif (widening) ou une shortlist plus courte` };
}

/**
 * What a search's result says of the problem searched, asked at `depth`: `[{ code, message }]`, the messages in
 * French for whoever reads the bot's log. `fewIterations`, `flatScore` (then no `closeCall`: every move ties),
 * `closeCall`, `shallow`; none when the root had fewer than two moves.
 */
export function hintsOf(result, depth) {
  if (result.stats.length < 2) return [];
  const flat = flatScore(result);
  const checks = [fewIterations(result), flat, flat ? null : closeCall(result), shallow(result, depth)];
  return checks.filter(Boolean);
}

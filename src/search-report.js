/**
 * What a search saw, read from its tree once it is done (Sami, 27/10/2026: hints to improve a bot without weighing
 * down the library): the result `search` returns, and `hintsOf`, what that result says about the problem searched.
 * Nothing here runs during the iterations; Lopin read the same from its trees (lopin/src/sim/mcts/tree-stats.js).
 */

export const meanOf = (node) => (node.visits > 0 ? node.total / node.visits : 0);

/** The tree under `root`: its nodes, the size of each level (the root's children are level 1), the deepest level. */
export function treeOf(root) {
  const levels = [];
  for (let layer = [...root.children.values()]; layer.length > 0; layer = layer.flatMap((node) => [...node.children.values()])) levels.push(layer.length);
  return { size: 1 + levels.reduce((sum, nodes) => sum + nodes, 0), depth: levels.length, levels };
}

/**
 * What `search` returns, read from the root's children: the move to play (the most visited, the better mean between
 * equals), its mean, each root move's visits and `{ key, move, visits, mean }` from the most visited; the tree's
 * `size`, `depth` and `levels`; the `iterations` run and the `ms` they took.
 */
export function resultOf(root, { iterations, ms }) {
  const stats = [...root.children.values()]
    .map((child) => ({ key: child.key, move: child.move, visits: child.visits, mean: meanOf(child) }))
    .sort((a, b) => b.visits - a.visits || b.mean - a.mean);
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
  };
}

const PER_MOVE = 20;
const percent = (mean) => `${Math.round(100 * mean)} %`;

function fewIterations({ iterations, stats }) {
  const per = Math.floor(iterations / stats.length);
  if (per >= PER_MOVE) return null;
  return { code: "fewIterations", message: `${per} itérations par coup de la racine (moins de ${PER_MOVE}) : un rollout plus rapide, une shortlist plus courte ou plus de temps` };
}

function flatScore({ stats }) {
  const means = stats.map((one) => one.mean);
  if (Math.max(...means) - Math.min(...means) >= 0.001) return null;
  return { code: "flatScore", message: `tous les coups de la racine valent ${percent(means[0])} : le score ne les départage pas, une récompense graduée (un retard, une marge) plutôt qu'un 0 ou 1` };
}

/** Two standard errors of a mean of `visits` scores between 0 and 1 (p(1 − p) bounds their variance). */
const errorOf = ({ mean, visits }) => Math.sqrt(Math.max(mean * (1 - mean), 0.01) / Math.max(visits, 1));

function closeCall({ stats }) {
  const [first, second] = stats;
  if (Math.abs(first.mean - second.mean) >= 2 * Math.hypot(errorOf(first), errorOf(second))) return null;
  const message = `les deux premiers coups (${first.key} ${percent(first.mean)}, ${second.key} ${percent(second.mean)}) se valent au bruit près : le choix est un tirage ; des mondes communs (common) ou plus d'itérations`;
  return { code: "closeCall", message };
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

#!/usr/bin/env node
import path from "node:path";
import { refusalOf, removeTree, scan } from "../node/worktree.js";

/**
 * `mcts-worktree`: removes a worktree, or a scratch folder, without crossing a link (node/worktree.js; mcts-codingame,
 * 19/11/2026: a `git worktree remove` that followed a junction emptied mcts-commun).
 *
 *   mcts-worktree --check DIR             the links under DIR (junctions, symbolic links); changes nothing
 *   mcts-worktree --remove DIR [--force]  undoes them, walks DIR again, then git worktree remove (--force to git)
 *   mcts-worktree --remove DIR --folder   the same for a plain folder (a subagents' wt/tmp): fs.rm at the end
 *
 * Exit 1 on a refusal: nothing is then deleted. docs/outillage.md.
 */
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const USAGE = "usage : mcts-worktree --check DOSSIER | --remove DOSSIER [--force] [--folder]   (docs/outillage.md)";

const linkLine = (link) => `  ${link.path} → ${link.target}`;

async function check(dir) {
  const refusal = await refusalOf(dir, { folder: true });
  if (refusal) throw new Error(refusal);
  const { links, repos } = await scan(dir);
  console.log(links.length ? `${links.length} lien(s) sous ${dir} :\n${links.map(linkLine).join("\n")}` : `Aucun lien sous ${dir}.`);
  if (repos.length) console.log(`Dépôt(s) dedans, que --remove refusera : ${repos.join(", ")}`);
}

async function remove(dir) {
  const links = await removeTree(dir, { folder: args.includes("--folder"), force: args.includes("--force") });
  if (links.length) console.log(`Liens défaits (leurs cibles intactes) :\n${links.map(linkLine).join("\n")}`);
  console.log(`Retiré : ${dir}`);
}

const target = option("--check") ?? option("--remove");
if (!target || args.includes("--help")) {
  console.log(USAGE);
  process.exit(args.includes("--help") ? 0 : 1);
}
try {
  await (args.includes("--check") ? check : remove)(path.resolve(target));
} catch (error) {
  console.error(`Refusé : ${error.message}`);
  process.exit(1);
}

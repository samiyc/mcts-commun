import { execFile } from "node:child_process";
import { lstat, readdir, readlink, rm, rmdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/**
 * Removing a worktree, or a scratch folder, without crossing a link (mcts-codingame, 19/11/2026: `git worktree remove
 * --force` followed `<wt>/node_modules`, a junction, then the `file:` link `node_modules/mcts-commun`, and emptied the
 * whole of mcts-commun, `.git` included; the third time a recursive delete went through a link to the library). The
 * links are undone first, the folder walked again, and nothing is deleted while a single one is left.
 */
const exec = promisify(execFile);
/** The environment without git's own variables: a git hook exports GIT_INDEX_FILE, GIT_DIR…, which would aim `git -C dir` elsewhere. */
export const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
const run = (command, args) => exec(command, args, { env: cleanEnv() });
/** mcts-commun's root: never removed, nor any folder holding it. */
export const LIB_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** True when `inner` is `outer` or lies under it (case-insensitive on Windows: path.win32.relative). */
const within = (inner, outer) => {
  const rel = path.relative(outer, inner);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** The links under `dir` (symbolic links and Windows junctions: lstat sees both as links), never descended, and the repositories (a `.git` folder). */
export async function scan(dir) {
  const found = { links: [], repos: [] };
  const visit = async (full) => {
    const info = await lstat(full);
    if (info.isSymbolicLink()) found.links.push({ path: full, target: await readlink(full).catch(() => "?") });
    else if (info.isDirectory() && path.basename(full) === ".git") found.repos.push(path.dirname(full));
    else if (info.isDirectory()) await walk(full);
  };
  const walk = async (folder) => {
    const entries = await readdir(folder, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => !entry.isFile()).map((entry) => visit(path.join(folder, entry.name))));
  };
  await walk(dir);
  return found;
}

/** Why the path `dir` is never removed, whatever it holds: a drive's root, a folder holding the home folder or mcts-commun. */
function placeRefusal(dir) {
  if (path.parse(dir).root === dir) return `${dir} est une racine de disque`;
  if (within(os.homedir(), dir)) return `${dir} contient le dossier personnel`;
  if (within(LIB_ROOT, dir)) return `${dir} est ou contient mcts-commun`;
  return null;
}

/** What `dir` is, when it is no folder to remove: missing, a link itself, a file. */
async function kindRefusal(dir) {
  const info = await lstat(dir).catch(() => null);
  if (!info) return `${dir} n'existe pas`;
  if (info.isSymbolicLink()) return `${dir} est lui-même un lien : le défaire suffit (rmdir sans /s)`;
  return info.isDirectory() ? null : `${dir} n'est pas un dossier`;
}

/** A repository (a `.git` folder) is never removed; without `folder`, only a linked worktree (a `.git` file) is. */
async function gitRefusal(dir, folder) {
  const git = await lstat(path.join(dir, ".git")).catch(() => null);
  if (git?.isDirectory()) return `${dir} est un dépôt (un dossier .git), jamais un worktree`;
  if (!folder && !git?.isFile()) return `${dir} n'est pas un worktree lié (pas de fichier .git) : --folder pour un dossier ordinaire`;
  return null;
}

/** Why `dir` is never removed by this tool, or null: the checks that need no walk. */
export async function refusalOf(dir, { folder = false } = {}) {
  return placeRefusal(dir) ?? (await kindRefusal(dir)) ?? (await gitRefusal(dir, folder));
}

/** Undoes one link, never its target: unlink, else rmdir (a directory link on Windows); both remove the reparse point only. */
const undo = (link) => unlink(link).catch(() => rmdir(link));

/** The repository a linked worktree belongs to, and whether the worktree has changes. */
async function worktreeOf(dir) {
  const common = await run("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const status = await run("git", ["-C", dir, "status", "--porcelain"]);
  return { main: path.dirname(common.stdout.trim()), dirty: status.stdout.trim() !== "" };
}

/** Refuses before anything changes: a refusal of principle, a repository inside, a worktree with changes and no `force`. */
async function guard(dir, { folder, force }) {
  const refusal = await refusalOf(dir, { folder });
  if (refusal) throw new Error(refusal);
  const found = await scan(dir);
  if (found.repos.length > 0) throw new Error(`${dir} contient un dépôt : ${found.repos.join(", ")}`);
  const tree = folder ? null : await worktreeOf(dir);
  if (tree?.dirty && !force) throw new Error(`${dir} a des changements (git status) : --force pour les perdre`);
  return { found, tree };
}

/**
 * Removes the worktree `dir` (or, with `folder`, a scratch folder): its links undone, the folder walked again, then
 * `git worktree remove` from its repository (or fs.rm, which follows no link). `force` passes `--force` to git.
 * Returns the links undone; throws, having deleted nothing, at the first refusal.
 */
export async function removeTree(dir, { folder = false, force = false } = {}) {
  const { found, tree } = await guard(dir, { folder, force });
  for (const link of found.links) await undo(link.path);
  const left = (await scan(dir)).links;
  if (left.length > 0) throw new Error(`il reste ${left.length} lien(s), rien n'est supprimé : ${left.map((link) => link.path).join(", ")}`);
  if (tree) await run("git", ["-C", tree.main, "worktree", "remove", ...(force ? ["--force"] : []), dir]);
  else await rm(dir, { recursive: true, maxRetries: 5 });
  return found.links;
}

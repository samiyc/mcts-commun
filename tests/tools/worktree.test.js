import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { LIB_ROOT, cleanEnv, refusalOf, removeTree, scan } from "../../node/worktree.js";

/**
 * `mcts-worktree` (node/worktree.js): the links undone, never followed (mcts-codingame, 19/11/2026: a `git worktree remove`
 * through a junction emptied mcts-commun). Every removal here happens in a temporary folder; the refusals of principle are
 * asked of `refusalOf`, which deletes nothing.
 */
const run = promisify(execFile);
const WORKTREE = fileURLToPath(new URL("../../bin/worktree.js", import.meta.url));
const exists = (file) => access(file).then(() => true, () => false);

/** `work(root)` in a temporary folder holding `target/witness.txt`, the file no removal may touch. */
async function scratch(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "worktree-"));
  try {
    await mkdir(path.join(root, "target"));
    await writeFile(path.join(root, "target", "witness.txt"), "garde-moi");
    await work(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
}

// Under the pre-commit hook, git exports GIT_INDEX_FILE and the like: left in, they aim these commands at mcts-commun's index.
const git = (cwd, ...args) => run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=", ...args], { cwd, env: cleanEnv() });

describe("mcts-worktree (node/worktree.js)", () => {
  it("lists a junction, removes a plain folder through it and leaves its target whole", () =>
    scratch(async (root) => {
      const folder = path.join(root, "wt", "tmp");
      await mkdir(path.join(folder, "deep"), { recursive: true });
      await symlink(path.join(root, "target"), path.join(folder, "deep", "node_modules"), "junction");
      const { links } = await scan(folder);
      assert.deepEqual(links.map((link) => path.relative(folder, link.path)), [path.join("deep", "node_modules")]);
      const { stdout } = await run(process.execPath, [WORKTREE, "--check", folder]);
      assert.match(stdout, /1 lien\(s\)/);
      await assert.rejects(removeTree(folder), /pas un worktree lié/);
      assert.equal((await removeTree(folder, { folder: true })).length, 1);
      assert.equal(await exists(folder), false);
      assert.equal(await readFile(path.join(root, "target", "witness.txt"), "utf8"), "garde-moi");
    }));

  it("removes a real worktree with a node_modules junction: the target survives, git forgets the worktree", () =>
    scratch(async (root) => {
      const main = path.join(root, "main");
      await mkdir(main);
      await git(main, "init", "-q");
      await writeFile(path.join(main, "a.txt"), "a");
      await writeFile(path.join(main, ".gitignore"), "node_modules\n");
      await git(main, "add", ".");
      await git(main, "commit", "-q", "-m", "a");
      const tree = path.join(root, "main-wt", "agent");
      await git(main, "worktree", "add", "-q", tree);
      await symlink(path.join(root, "target"), path.join(tree, "node_modules"), "junction");
      await writeFile(path.join(tree, "a.txt"), "changed");
      await assert.rejects(removeTree(tree), /des changements/);
      assert.equal(await exists(path.join(tree, "node_modules", "witness.txt")), true, "un refus ne défait rien");
      const { stdout } = await run(process.execPath, [WORKTREE, "--remove", tree, "--force"]);
      assert.match(stdout, /Liens défaits[\s\S]*Retiré/);
      assert.equal(await exists(tree), false);
      assert.equal(await readFile(path.join(root, "target", "witness.txt"), "utf8"), "garde-moi");
      assert.doesNotMatch((await git(main, "worktree", "list")).stdout, /agent/);
    }));

  it("refuses a repository, a folder holding one, mcts-commun and its parents, the home folder, a missing folder", () =>
    scratch(async (root) => {
      const repo = path.join(root, "repo");
      await mkdir(path.join(repo, ".git"), { recursive: true });
      assert.match(await refusalOf(repo, { folder: true }), /un dépôt/);
      await assert.rejects(removeTree(root, { folder: true }), /contient un dépôt/);
      assert.equal(await exists(path.join(root, "target", "witness.txt")), true);
      assert.match(await refusalOf(path.resolve(LIB_ROOT), { folder: true }), /mcts-commun/);
      assert.match(await refusalOf(path.dirname(path.resolve(LIB_ROOT)), { folder: true }), /mcts-commun/);
      assert.match(await refusalOf(os.homedir(), { folder: true }), /dossier personnel/);
      assert.match(await refusalOf(path.parse(root).root, { folder: true }), /racine|personnel|mcts-commun/);
      assert.match(await refusalOf(path.join(root, "absent")), /n'existe pas/);
      await symlink(path.join(root, "target"), path.join(root, "link"), "junction");
      assert.match(await refusalOf(path.join(root, "link"), { folder: true }), /lui-même un lien/);
      await assert.rejects(run(process.execPath, [WORKTREE, "--remove", path.join(root, "link"), "--folder"]), /Refusé/);
    }));
});

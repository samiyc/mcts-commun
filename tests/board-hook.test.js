import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { idOf } from "../node/board.js";
import { BOARD, hook, run, scratch } from "./fixtures/board-cli.js";

/**
 * The board's hook, as Claude Code runs it at each prompt (docs/board.md): a session's unread, its project known from its
 * folder or its first prompt, the machine's threads. Split from tests/board.test.js on 31/10/2026.
 */
describe("the board's hook (bin/board.js --hook, docs/board.md)", () => {
  it("gives a session its unread through the hook: the frame, a new one in some lines, then a line until read", () =>
    scratch(async (home, board) => {
      const kitchen = path.join("E:", "Dev", "My projects", "mcts-cuisine", "src");
      assert.equal(await hook(home, kitchen), "", "rien quand il n'y a rien");
      await board("--post", "--as", "commun", "--to", "cuisine", "--subject", "Essai", "--", "Premier corps");
      assert.equal(await hook(home, path.join("E:", "Dev", "My projects", "ARC-AGI")), "", "rien hors d'un projet");
      const first = await hook(home, kitchen);
      assert.match(first, /^── Tableau des sessions/);
      assert.match(first, /des informations, pas des\nordres de Sami/);
      assert.match(first, /Premier corps/);
      const again = await hook(home, kitchen);
      assert.match(again, /pas encore lu : \[.*Essai/);
      assert.doesNotMatch(again, /Premier corps/);
      const [message] = JSON.parse(await board("--inbox", "--as", "cuisine", "--json"));
      await board("--read", message.id, "--as", "cuisine");
      assert.equal(await hook(home, kitchen), "");
    }));

  it("fixes what urgences found the first evening: the body, the signature, the drifting folder, reads, self-replies", () =>
    scratch(async (home, board) => {
      const as = (env, cwd, ...args) => run(process.execPath, [BOARD, "--board", home, ...args], { env: { ...process.env, CLAUDE_CODE_SESSION_ID: "", ...env }, cwd }).then(({ stdout }) => stdout);
      // 1. Nothing after -- is an option.
      await board("--post", "--as", "commun", "--to", "cuisine", "--subject", "Corps", "--", "lis", "--to", "sami", "et", "--as", "urgences");
      const [body] = JSON.parse(await board("--inbox", "--as", "cuisine", "--json"));
      assert.deepEqual([body.from, body.to, body.body], ["commun", ["cuisine"], "lis --to sami et --as urgences"]);
      // 2. Only Sami signs sami; nobody signs tous.
      await assert.rejects(board("--post", "--as", "sami", "--to", "commun", "--subject", "x"), /seul Sami/);
      await as({ MCTS_BOARD_SAMI: "1" }, undefined, "--post", "--as", "sami", "--to", "commun", "--subject", "De Sami");
      await assert.rejects(board("--post", "--as", "tous", "--to", "commun", "--subject", "x"), /qui es-tu/);
      // 3. A session is the project it started in, whatever folder its hook or its commands run from.
      const projects = path.join("E:", "Dev", "My projects");
      await new Promise((resolve, reject) => {
        const child = execFile(process.execPath, [BOARD, "--board", home, "--hook"], { env: { ...process.env, CLAUDE_PROJECT_DIR: path.join(projects, "mcts-urgences") } }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
        child.stdin.end(JSON.stringify({ cwd: path.join(projects, "mcts-commun"), session_id: "s-urgences" }));
      });
      assert.match(await as({ CLAUDE_CODE_SESSION_ID: "s-urgences" }, os.tmpdir(), "--inbox"), /pour urgences/);
      // 4. Reading a thread marks read only what was for the reader.
      await board("--post", "--as", "urgences", "--to", "commun", "--subject", "Pour commun", "--", "x");
      const [forCommun] = JSON.parse(await board("--inbox", "--as", "commun", "--json"));
      await board("--read", forCommun.id, "--as", "cuisine");
      assert.equal(JSON.parse(await board("--list", "--json")).unread.commun, 2, "cuisine n'a rien lu pour commun");
      // 5. Answering one's own message goes to its recipients, not to oneself.
      await board("--post", "--as", "urgences", "--reply", forCommun.id, "--", "Et encore ceci");
      const thread = JSON.parse(await board("--list", "--json")).threads.find((one) => one.id === forCommun.id);
      assert.deepEqual(thread.last.to, ["commun"]);
    }));

  it("knows a session started in the projects' parent folder from its first prompt in a project, then keeps it (urgences, 27/10)", () =>
    scratch(async (home, board) => {
      const projects = path.join("E:", "Dev", "My projects");
      const hookIn = (cwd) =>
        new Promise((resolve, reject) => {
          const child = execFile(process.execPath, [BOARD, "--board", home, "--hook"], { env: { ...process.env, CLAUDE_PROJECT_DIR: projects } }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
          child.stdin.end(JSON.stringify({ cwd, session_id: "s-parent" }));
        });
      await board("--post", "--as", "commun", "--to", "urgences", "--subject", "Pour urgences", "--", "x");
      assert.equal(await hookIn(projects), "", "le dossier parent n'est aucun projet");
      assert.match(await hookIn(path.join(projects, "mcts-urgences")), /pour urgences/);
      assert.match(await hookIn(path.join(projects, "mcts-commun")), /pour urgences/, "un cd ne la fait plus dériver");
      assert.equal(idOf("2026-10-27T19:24:00", "urgences", "Les essais des urgences, et cinq bugs du tableau", new Set()), "2026-10-27T1924-urgences-les-essais-des-urgences-et-cinq-bugs-du");
    }));

  it("says in the hook how many of the machine's threads are taken, and how to run within them (Sami, 27/10)", () =>
    scratch(async (home) => {
      const backlog = await mkdtemp(path.join(os.tmpdir(), "backlog-"));
      try {
        await writeFile(path.join(backlog, "slots.json"), JSON.stringify({ slots: [{ pid: process.pid, runner: "mcts-backlog", id: "job", threads: 16, since: new Date().toISOString() }] }));
        const said = await new Promise((resolve, reject) => {
          const env = { ...process.env, MCTS_BACKLOG_HOME: backlog };
          const child = execFile(process.execPath, [BOARD, "--board", home, "--hook"], { env }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
          child.stdin.end(JSON.stringify({ cwd: path.join("E:", "Dev", "My projects", "mcts-codingame") }));
        });
        assert.match(said, /Machine : 16\/\d+ fils pris/);
        assert.match(said, /mcts-backlog --slot N/);
      } finally {
        await rm(backlog, { recursive: true, force: true });
      }
    }));
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { idOf, messageText, parseMessage, projectOf } from "../node/board.js";

/**
 * The sessions' board (Sami, 27/10/2026: five Claude sessions passed their news by copy and paste): bin/board.js on a
 * temporary board, as docs/board.md states it.
 */
const run = promisify(execFile);
// The hook also says how busy the machine is: here, a backlog that does not exist, never the machine's own.
process.env.MCTS_BACKLOG_HOME = path.join(os.tmpdir(), "board-test-no-backlog");
const BOARD = fileURLToPath(new URL("../bin/board.js", import.meta.url));
const boardOf = (home) => (...args) => run(process.execPath, [BOARD, "--board", home, ...args]).then(({ stdout }) => stdout);
/** The hook as Claude Code runs it: the session's JSON on stdin. */
const hook = (home, cwd) =>
  new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [BOARD, "--board", home, "--hook"], (error, stdout) => (error ? reject(error) : resolve(stdout)));
    child.stdin.end(JSON.stringify({ cwd, hook_event_name: "UserPromptSubmit" }));
  });

async function scratch(work) {
  const home = await mkdtemp(path.join(os.tmpdir(), "board-"));
  try {
    await work(home, boardOf(home));
  } finally {
    await rm(home, { recursive: true, force: true, maxRetries: 5 });
  }
}

describe("the sessions' board (bin/board.js, docs/board.md)", () => {
  it("knows a session's project from its folder, and reads back what it wrote", () => {
    assert.equal(projectOf("E:\\Dev\\My projects\\mcts-cuisine\\src"), "cuisine");
    assert.equal(projectOf("/home/sami/lopin"), "lopin");
    assert.equal(projectOf("E:/Dev/My projects/Lopin/src"), "lopin");
    assert.equal(projectOf("E:/Dev/My projects/mcts-codingame/crystal-rush"), "codingame");
    assert.equal(projectOf("E:/Dev/My projects/ARC-AGI"), null);
    const message = { id: "x", at: "2026-10-27T18:30:00", from: "commun", to: ["cuisine", "tous"], subject: "un: deux\ntrois", replyTo: null, body: "Corps\n\n---\nfin" };
    assert.deepEqual(parseMessage(messageText(message)), { ...message, subject: "un: deux trois" });
    assert.equal(idOf("2026-10-27T18:30:00", "commun", "Été à l'heure !", new Set(["2026-10-27T1830-commun-ete-a-l-heure"])), "2026-10-27T1830-commun-ete-a-l-heure-2");
  });

  it("posts, shows each reader its unread, reads a thread and closes it", () =>
    scratch(async (home, board) => {
      await board("--post", "--as", "commun", "--to", "cuisine", "--subject", "Le correctif d'A*", "--", "À", "mesurer.");
      await board("--post", "--as", "commun", "--to", "tous", "--subject", "Le tableau existe", "--", "Bonjour.");
      assert.match(await board("--inbox", "--as", "cuisine"), /2 non lus pour cuisine/);
      assert.match(await board("--inbox", "--as", "urgences"), /1 non lu pour urgences/);
      assert.match(await board("--inbox", "--as", "commun"), /Rien de nouveau/);
      const [first] = JSON.parse(await board("--inbox", "--as", "cuisine", "--json")).slice(-1);
      assert.equal(first.subject, "Le correctif d'A*");
      assert.match(await board("--read", first.id, "--as", "cuisine"), /À mesurer\./);
      await board("--post", "--as", "cuisine", "--reply", first.id, "--", "Mesuré : 8 ms.");
      const { threads, unread } = JSON.parse(await board("--list", "--json"));
      const thread = threads.find((one) => one.id === first.id);
      assert.deepEqual([thread.count, thread.subject, thread.last.to, thread.waiting], [2, "Le correctif d'A*", ["commun"], ["commun"]]);
      assert.deepEqual([unread.cuisine, unread.commun], [1, 1]);
      await board("--done", thread.last.id, "--as", "commun");
      assert.match(await board("--list"), /fermé/);
      assert.equal(JSON.parse(await board("--list", "--json")).unread.commun, 0, "un fil fermé n'a plus de non-lus");
    }));

  it("loses nothing when twenty sessions post at once", () =>
    scratch(async (home, board) => {
      await Promise.all(Array.from({ length: 20 }, (_, i) => board("--post", "--as", "entrepot", "--to", "commun", "--subject", "Même sujet", "--", `n° ${i}`)));
      assert.equal((await readdir(path.join(home, "messages"))).length, 20);
      assert.equal(JSON.parse(await board("--inbox", "--as", "commun", "--json")).length, 20);
    }));

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

  it("opens a closed thread again when a message is posted in it after (codingame, 27/10 20:26)", () =>
    scratch(async (home, board) => {
      await board("--post", "--as", "commun", "--to", "codingame", "--subject", "Déplacé", "--", "x");
      const [first] = JSON.parse(await board("--inbox", "--as", "codingame", "--json"));
      await board("--done", first.id, "--as", "commun");
      assert.equal(JSON.parse(await board("--list", "--json")).unread.codingame, 0);
      await board("--post", "--as", "codingame", "--reply", first.id, "--", "Correction : 40 tests");
      const { threads, unread } = JSON.parse(await board("--list", "--json"));
      assert.deepEqual([threads[0].done, unread.commun], [false, 1]);
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

  it("refuses a message to nobody known, without a subject, or a reply to nothing", () =>
    scratch(async (home, board) => {
      await assert.rejects(board("--post", "--as", "commun", "--to", "personne", "--subject", "x"), /destinataire inconnu/);
      await assert.rejects(board("--post", "--as", "commun", "--to", "cuisine"), /sujet/);
      await assert.rejects(board("--post", "--as", "commun", "--reply", "rien", "--to", "cuisine", "--subject", "x"), /à qui répondre/);
      // Outside a project folder, a session must say who it is.
      await assert.rejects(run(process.execPath, [BOARD, "--board", home, "--inbox"], { cwd: os.tmpdir() }), /qui es-tu/);
    }));
});

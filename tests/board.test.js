import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { idOf, messageText, parseMessage, projectOf } from "../node/board.js";
import { markReadFor } from "../node/board-store.js";
import { BOARD, run, scratch } from "./fixtures/board-cli.js";

/**
 * The sessions' board (Sami, 27/10/2026: five Claude sessions passed their news by copy and paste): bin/board.js on a
 * temporary board, as docs/board.md states it. The hook has its own file, tests/board-hook.test.js (31/10/2026).
 */
describe("the sessions' board (bin/board.js, docs/board.md)", () => {
  it("knows a session's project from its folder, and reads back what it wrote", () => {
    assert.equal(projectOf("E:\\Dev\\My projects\\mcts-cuisine\\src"), "cuisine");
    assert.equal(projectOf("/home/sami/lopin"), "lopin");
    assert.equal(projectOf("E:/Dev/My projects/Lopin/src"), "lopin");
    assert.equal(projectOf("E:/Dev/My projects/mcts-codingame/crystal-rush"), "codingame");
    assert.equal(projectOf("E:/Dev/My projects/mcts-feux/src"), "feux");
    assert.equal(projectOf("E:/Dev/My projects/mcts-agenda"), "agenda");
    assert.equal(projectOf("E:/Dev/My projects/raquette/web"), "raquette");
    assert.equal(projectOf("E:/Dev/My projects/Proteines"), "proteines");
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

  it("marks read Sami's messages, a thread's or all, as the TUI's l and L and the page's buttons do (Sami, 27/10)", () =>
    scratch(async (home, board) => {
      await board("--post", "--as", "commun", "--to", "sami", "--subject", "Un", "--", "x");
      await board("--post", "--as", "cuisine", "--to", "tous", "--subject", "Deux", "--", "y");
      await board("--post", "--as", "entrepot", "--to", "commun", "--subject", "Pas pour Sami", "--", "z");
      const [one] = JSON.parse(await board("--inbox", "--as", "sami", "--json")).filter((message) => message.subject === "Un");
      assert.equal(await markReadFor("sami", { thread: one.id, home }), 1);
      assert.equal(JSON.parse(await board("--list", "--json")).unread.sami, 1);
      assert.equal(await markReadFor("sami", { home }), 1, "le reste, sans le message à commun");
      const { unread } = JSON.parse(await board("--list", "--json"));
      assert.deepEqual([unread.sami, unread.commun], [0, 2], "commun garde les siens : le message à tous et le sien");
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

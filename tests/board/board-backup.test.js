import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BACKUP_EVERY_MS, KEEP_DAYS, backupBoard, latestBackup, restoreBoard } from "../../node/board/backup.js";
import { BOARD, boardOf } from "../fixtures/board-cli.js";

/**
 * The board's copy outside the library (node/board/backup.js; mcts-codingame, 19/11/2026: `board/` came back only
 * through Windows File Recovery) and the hook's alert when the board looks emptied. Temporary folders only.
 */
async function scratch(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "board-backup-"));
  try {
    await work(path.join(root, "board"), path.join(root, "copies"));
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
}

const post = (home, subject) => boardOf(home)("--post", "--as", "commun", "--to", "cuisine", "--subject", subject, "--", "corps");
const HOUR = BACKUP_EVERY_MS;
const DAY_MS = 86_400_000;

/** The hook as Claude Code runs it, with the copies kept in `copies`. */
const hook = (home, copies) =>
  new Promise((resolve, reject) => {
    const env = { ...process.env, MCTS_BOARD_BACKUP: copies };
    const child = execFile(process.execPath, [BOARD, "--board", home, "--hook"], { env }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
    child.stdin.end(JSON.stringify({ cwd: path.join(os.tmpdir(), "mcts-cuisine"), session_id: "s1" }));
  });

describe("the board's copy (node/board/backup.js, docs/board.md)", () => {
  it("copies once an hour, keeps 14 days, never copies over a good copy a board that shrank", () =>
    scratch(async (home, copies) => {
      assert.equal((await backupBoard(home, copies)).status, "empty");
      await post(home, "Un");
      const now = Date.UTC(2026, 10, 20, 12);
      const first = await backupBoard(home, copies, now);
      assert.equal(first.status, "copied");
      assert.deepEqual([first.copy.messages, first.copy.journal], [1, 1]);
      await post(home, "Deux");
      assert.equal((await backupBoard(home, copies, now + HOUR / 2)).status, "fresh");
      assert.equal((await backupBoard(home, copies, now + HOUR)).copy.messages, 2);
      await rm(path.join(home, "messages"), { recursive: true });
      const shrunk = await backupBoard(home, copies, now + 3 * HOUR);
      assert.deepEqual([shrunk.status, shrunk.size.messages, shrunk.last.messages], ["shrunk", 0, 2]);
      assert.equal((await latestBackup(copies)).messages, 2, "la bonne copie reste");
    }));

  it("keeps the last 14 days", () =>
    scratch(async (home, copies) => {
      await post(home, "Un");
      const start = Date.UTC(2026, 10, 1, 12);
      for (let day = 0; day < KEEP_DAYS + 3; day += 1) await backupBoard(home, copies, start + day * DAY_MS);
      const days = (await readdir(copies)).sort();
      assert.equal(days.length, KEEP_DAYS);
      assert.equal(days.at(-1), "2026-11-17");
    }));

  it("restores what the board lacks, merges the journals, overwrites nothing, and adds nothing the second time", () =>
    scratch(async (home, copies) => {
      await post(home, "Un");
      await post(home, "Deux");
      await backupBoard(home, copies);
      const before = await readdir(path.join(home, "messages"));
      await rm(home, { recursive: true });
      await mkdir(home);
      await writeFile(path.join(home, "sessions.json"), JSON.stringify({ s9: { project: "cuisine" } }));
      await post(home, "Trois");
      const done = await restoreBoard(home, copies);
      assert.deepEqual([done.messages, done.journal], [2, 2]);
      assert.equal((await readdir(path.join(home, "messages"))).length, 3);
      assert.ok(before.every((name) => name.endsWith(".md")));
      const subjects = JSON.parse(await boardOf(home)("--list", "--json")).threads.map((thread) => thread.subject).sort();
      assert.deepEqual(subjects, ["Deux", "Trois", "Un"]);
      assert.ok(JSON.parse(await readFile(path.join(home, "sessions.json"), "utf8")).s9, "les sessions du tableau restent");
      assert.deepEqual(Object.values(await restoreBoard(home, copies)).slice(1), [0, 0]);
      await assert.rejects(restoreBoard(home, path.join(copies, "absent")), /pas de sauvegarde/);
    }));

  it("makes the hook copy the board, then alert and leave sessions.json alone once the board is emptied", () =>
    scratch(async (home, copies) => {
      await post(home, "Un");
      assert.doesNotMatch(await hook(home, copies), /Alerte/);
      assert.equal((await latestBackup(copies)).messages, 1);
      await rm(home, { recursive: true });
      const alert = await hook(home, copies);
      assert.match(alert, /Alerte : le tableau a 0 messages.*en a 1.*--restore/);
      await assert.rejects(readFile(path.join(home, "sessions.json")), /ENOENT/);
      const env = { ...process.env, MCTS_BOARD_BACKUP: copies };
      const out = await new Promise((resolve, reject) => execFile(process.execPath, [BOARD, "--board", home, "--restore"], { env }, (error, stdout) => (error ? reject(error) : resolve(stdout))));
      assert.match(out, /1 message\(s\)/);
      assert.doesNotMatch(await hook(home, copies), /Alerte/);
    }));
});

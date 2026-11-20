import { constants } from "node:fs";
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withLock } from "../machine.js";
import { boardHome } from "./store.js";

/**
 * A copy of the board outside mcts-commun (mcts-codingame, 19/11/2026: a `git worktree remove` emptied the library, and
 * `board/`, out of git, came back only through Windows File Recovery). `<root>/<YYYY-MM-DD>/` holds `messages/`,
 * `journal.jsonl`, `sessions.json` and `backup.json` (when, how many messages and journal lines). The hook refreshes the
 * day's copy when the last is an hour old, keeps 14 days, and never copies a board smaller than its last copy: no message
 * is ever deleted, so a smaller board is a board emptied (docs/board.md, « La sauvegarde »).
 */
export const BACKUP_EVERY_MS = 3_600_000;
export const KEEP_DAYS = 14;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FILES = ["journal.jsonl", "sessions.json"];

/** Where the board in `home` is copied: MCTS_BOARD_BACKUP, else `~/.mcts-board-backup` for mcts-commun's own board, else nowhere. */
export function backupRoot(home) {
  if (process.env.MCTS_BOARD_BACKUP) return path.resolve(process.env.MCTS_BOARD_BACKUP);
  return path.resolve(home) === path.resolve(boardHome()) ? path.join(os.homedir(), ".mcts-board-backup") : null;
}

/** The local day, `2026-11-20`. */
const localDay = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const linesOf = (text) => text.split("\n").filter((line) => line.trim());
const messageNames = async (folder) => (await readdir(path.join(folder, "messages")).catch(() => [])).filter((name) => name.endsWith(".md"));

/** How big the board in `folder` is: its messages and its journal's lines. */
export async function sizeOf(folder) {
  const journal = await readFile(path.join(folder, "journal.jsonl"), "utf8").catch(() => "");
  return { messages: (await messageNames(folder)).length, journal: linesOf(journal).length };
}

/** The latest copy under `root`: `{ day, folder, at, messages, journal }`, or null. */
export async function latestBackup(root) {
  const days = (await readdir(root).catch(() => [])).filter((name) => DAY.test(name)).sort();
  for (const day of days.reverse()) {
    const folder = path.join(root, day);
    const meta = await readFile(path.join(folder, "backup.json"), "utf8").then(JSON.parse, () => null);
    if (meta) return { day, folder, ...meta };
  }
  return null;
}

/** True when the board is smaller than its last copy: emptied, never to be copied over it. */
export const shrunk = (size, last) => Boolean(last) && (size.messages < last.messages || size.journal < last.journal);

/** Writes the day's copy of `home` under `root` through `<day>.tmp`, then keeps the last KEEP_DAYS days. */
async function copyBoard(home, root, now) {
  const day = localDay(now);
  const tmp = path.join(root, `${day}.tmp`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  await cp(path.join(home, "messages"), path.join(tmp, "messages"), { recursive: true });
  for (const file of FILES) await copyFile(path.join(home, file), path.join(tmp, file)).catch(() => {});
  const size = await sizeOf(tmp);
  await writeFile(path.join(tmp, "backup.json"), JSON.stringify({ at: now, ...size }));
  await rm(path.join(root, day), { recursive: true, force: true });
  await rename(tmp, path.join(root, day));
  const days = (await readdir(root)).filter((name) => DAY.test(name)).sort();
  await Promise.all(days.slice(0, -KEEP_DAYS).map((old) => rm(path.join(root, old), { recursive: true, force: true })));
  return { day, ...size };
}

/**
 * Copies the board in `home` under `root` when its last copy is BACKUP_EVERY_MS old: `{ status }`, "copied" (with the
 * copy), "fresh", "empty" (nothing to copy) or "shrunk" (smaller than the last copy: left alone, `last` given).
 */
export async function backupBoard(home, root, now = Date.now()) {
  const decide = async () => {
    const last = await latestBackup(root);
    const size = await sizeOf(home);
    if (shrunk(size, last)) return { status: "shrunk", size, last };
    if (last && now - last.at < BACKUP_EVERY_MS) return { status: "fresh", size, last };
    return size.messages === 0 ? { status: "empty", size, last } : null;
  };
  const first = await decide();
  if (first) return first;
  return withLock(home, async () => (await decide()) ?? { status: "copied", copy: await copyBoard(home, root, now) }, "board");
}

const atOf = (line) => {
  try {
    return String(JSON.parse(line).at ?? "");
  } catch {
    return "";
  }
};

/** The union of two journals' lines, each once, in the order of their `at`. */
const mergedJournal = (ours, theirs) => {
  const lines = [...new Set([...linesOf(ours), ...linesOf(theirs)])];
  return lines.map((line, i) => ({ line, i, at: atOf(line) })).sort((a, b) => a.at.localeCompare(b.at) || a.i - b.i).map(({ line }) => line);
};

const readText = (file) => readFile(file, "utf8").catch(() => "");

/**
 * Puts back into `home` what its copy `day` (the latest by default) has and it lacks: the missing messages (none
 * overwritten), the journal's lines (a union), the sessions (the board's own win). Run twice, it adds nothing more.
 */
export async function restoreBoard(home, root, day = null) {
  const backup = day ? path.join(root, day) : (await latestBackup(root))?.folder;
  const names = backup ? await messageNames(backup) : [];
  if (names.length === 0) throw new Error(`pas de sauvegarde ${day ?? ""} sous ${root}`);
  return withLock(home, async () => {
    await mkdir(path.join(home, "messages"), { recursive: true });
    const have = new Set(await messageNames(home));
    const missing = names.filter((name) => !have.has(name));
    for (const name of missing) await copyFile(path.join(backup, "messages", name), path.join(home, "messages", name), constants.COPYFILE_EXCL);
    const ours = await readText(path.join(home, "journal.jsonl"));
    const journal = mergedJournal(ours, await readText(path.join(backup, "journal.jsonl")));
    await writeFile(path.join(home, "journal.jsonl"), journal.map((line) => `${line}\n`).join(""));
    const sessions = async (folder) => JSON.parse((await readText(path.join(folder, "sessions.json"))) || "{}");
    await writeFile(path.join(home, "sessions.json"), JSON.stringify({ ...(await sessions(backup)), ...(await sessions(home)) }, null, 1));
    return { from: path.basename(backup), messages: missing.length, journal: journal.length - linesOf(ours).length };
  }, "board");
}

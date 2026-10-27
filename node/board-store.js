import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { READERS, boardOf, checkNames, idOf, messageText, parseMessage, threadsOf, unreadOf } from "./board.js";
import { withLock } from "./machine.js";

/**
 * The board on disk (node/board.js): `<home>/messages/<id>.md`, a file a message, and `<home>/journal.jsonl`, a line
 * an event (`posted`, `shown`, `read`, `done`). The home is mcts-commun's `board/`, out of git (Sami, 27/10/2026),
 * or `MCTS_BOARD_HOME`. Every write holds the board's lock (`withLock`, node/machine.js), as the queue's do.
 */
export const boardHome = () => process.env.MCTS_BOARD_HOME || fileURLToPath(new URL("../board/", import.meta.url));

/** The local time to the second, `2026-10-27T18:30:05`: the messages sort by it. */
const localNow = (date = new Date()) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

async function readMessages(folder) {
  const names = (await readdir(folder).catch(() => [])).filter((name) => name.endsWith(".md"));
  const texts = await Promise.all(names.map((name) => readFile(path.join(folder, name), "utf8")));
  return texts.map((text, i) => ({ ...parseMessage(text), file: path.join(folder, names[i]) })).filter((message) => message.id);
}

/** The sessions' map, `{ [session id]: { project, at } }`; {} when there is none. */
async function readSessions(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return {};
  }
}

async function readJournal(file) {
  const text = await readFile(file, "utf8").catch(() => "");
  return text.split("\n").flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}

/** What the views show of the board (the TUI's tab, the page's `/api/board`): every thread, the unread by reader. */
export async function boardView(home = boardHome()) {
  const board = await createBoard(home).read();
  return { threads: threadsOf(board), unread: Object.fromEntries(READERS.map((reader) => [reader, unreadOf(board, reader).length])) };
}

/** The board kept in `home`: `read()` its state (node/board.js `boardOf`), `post(message)`, `mark(kind, ids, by)`. */
export function createBoard(home = boardHome()) {
  const folder = path.join(home, "messages");
  const journalFile = path.join(home, "journal.jsonl");
  const note = (kind, ids, by) => appendFile(journalFile, ids.map((id) => `${JSON.stringify({ at: new Date().toISOString(), kind, id, by })}\n`).join(""));
  const read = async () => boardOf(await readMessages(folder), await readJournal(journalFile));
  const sessionsFile = path.join(home, "sessions.json");
  return {
    home,
    read,
    /** The project a Claude session started in, as its hook saw it (27/10/2026, urgences: the folder of the moment drifts). */
    sessionOf: async (session) => (await readSessions(sessionsFile))[session]?.project ?? null,
    /** Keeps which project `session` started in; written only when it changes. */
    async rememberSession(session, project) {
      if ((await readSessions(sessionsFile))[session]?.project === project) return;
      await withLock(home, async () => {
        const all = await readSessions(sessionsFile);
        await writeFile(sessionsFile, JSON.stringify({ ...all, [session]: { project, at: new Date().toISOString() } }, null, 1));
      }, "board");
    },
    /** Writes a new message from `from` to `to` (a reply to `replyTo`): the message, with its id and file. */
    post: ({ from, to, subject, body, replyTo = null }) =>
      withLock(home, async () => {
        checkNames([from], { everyone: false });
        checkNames(to);
        if (!String(subject ?? "").trim()) throw new Error("un message a un sujet (--subject)");
        const board = await read();
        if (replyTo && !board.byId.has(replyTo)) throw new Error(`pas de message ${replyTo} à qui répondre`);
        const at = localNow();
        const message = { id: idOf(at, from, subject, new Set(board.byId.keys())), at, from, to, subject, replyTo, body };
        await mkdir(folder, { recursive: true });
        const file = path.join(folder, `${message.id}.md`);
        await writeFile(file, messageText(message), { flag: "wx" });
        await note("posted", [message.id], from);
        return { ...message, file };
      }, "board"),
    /** Journals `kind` (`shown`, `read`, `done`) for the messages `ids`, by `by`. */
    mark: (kind, ids, by) => (ids.length === 0 ? Promise.resolve() : withLock(home, () => note(kind, ids, by), "board")),
  };
}

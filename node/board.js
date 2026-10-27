/**
 * The sessions' board (Sami, 27/10/2026: five Claude sessions, commun, the kitchen, the warehouse, the emergencies and
 * CodinGame, passed their news by copy and paste; « something more tooled and traced, so as to miss nothing »). A
 * message is a Markdown file with a header, never rewritten; what happens to it (posted, shown by the hook, read,
 * its thread closed) is a journal line. Who has read what, and which threads wait on whom, follow from both. Pure:
 * node/board-store.js reads and writes, bin/board.js is the command, docs/board.md the contract.
 */

/** The projects a session works in, and their folders; `sami` reads and posts too, `tous` is everyone. */
export const PROJECTS = Object.freeze(["commun", "cuisine", "entrepot", "urgences", "codingame", "lopin"]);
export const READERS = Object.freeze([...PROJECTS, "sami"]);
// Matched without case (Windows: Lopin or lopin); CodinGame's bots live in "Algo code in game" until renamed (27/10/2026).
const FOLDERS = { "mcts-commun": "commun", "mcts-cuisine": "cuisine", "mcts-entrepot": "entrepot", "mcts-urgences": "urgences", "mcts-codingame": "codingame", "algo code in game": "codingame", lopin: "lopin" };

/** The project folder `dir` is in (the nearest parent named like one), or null outside them. */
export function projectOf(dir) {
  const parts = String(dir ?? "").split(/[\\/]+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) if (FOLDERS[parts[i].toLowerCase()]) return FOLDERS[parts[i].toLowerCase()];
  return null;
}

/** Throws unless every name of `names` is a reader, or `tous` among recipients (`everyone`); `tous` never signs. */
export function checkNames(names, { everyone = true } = {}) {
  const unknown = names.filter((name) => !(everyone && name === "tous") && !READERS.includes(name));
  if (unknown.length > 0 || names.length === 0) throw new Error(`destinataire inconnu : ${unknown.join(", ") || "aucun"} (${[...READERS, "tous"].join(", ")})`);
  return names;
}

const HEADER = ["id", "at", "from", "to", "subject", "replyTo"];
const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

/** A message's file: its header between `---`, then its body. */
export function messageText({ id, at, from, to, subject, replyTo = null, body }) {
  const values = { id, at, from, to: to.join(", "), subject: oneLine(subject), replyTo: replyTo ?? "" };
  return ["---", ...HEADER.map((key) => `${key}: ${values[key]}`), "---", "", String(body ?? "").trim(), ""].join("\n");
}

/** A message read back from its file, or null when the file is not one. */
export function parseMessage(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return null;
  const header = Object.fromEntries(match[1].split(/\r?\n/).map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]));
  if (!header.id || !header.from) return null;
  const to = header.to ? header.to.split(",").map((name) => name.trim()).filter(Boolean) : [];
  return { id: header.id, at: header.at, from: header.from, to, subject: header.subject ?? "", replyTo: header.replyTo || null, body: match[2].trim() };
}

/** A short ASCII slug of `subject`, for the file's name. */
export const slugOf = (subject) =>
  oneLine(subject)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    // Cut first, then trimmed: a cut may end on a dash (urgences, 27/10/2026: …-cinq-bugs-du-).
    .replace(/^-|-$/g, "") || "message";

/** A new message's id: its minute, its author, its subject; `-2`, `-3`… when another holds it. */
export function idOf(at, from, subject, taken) {
  const base = `${at.slice(0, 16).replace(":", "")}-${from}-${slugOf(subject)}`;
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

/** Whether `message` is for `reader`: named, or everyone's, and not their own. */
export const isFor = (message, reader) => message.from !== reader && (message.to.includes(reader) || message.to.includes("tous"));

/** The board as the journal leaves it: each message's thread (its first message's id), who read or was shown what, the threads closed. */
export function boardOf(messages, journal) {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const rootOf = (message) => {
    let at = message;
    for (let hops = 0; at.replyTo && byId.has(at.replyTo) && hops < messages.length; hops += 1) at = byId.get(at.replyTo);
    return at.id;
  };
  const marks = (kind) => new Set(journal.filter((entry) => entry.kind === kind).map((entry) => `${entry.id}|${entry.by}`));
  const done = new Set(journal.filter((entry) => entry.kind === "done").map((entry) => entry.id));
  return { messages: [...messages].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)), byId, rootOf, read: marks("read"), shown: marks("shown"), done };
}

/** The messages `reader` has not read, their threads open: the oldest first. */
export function unreadOf(board, reader) {
  return board.messages.filter((message) => isFor(message, reader) && !board.read.has(`${message.id}|${reader}`) && !board.done.has(board.rootOf(message)));
}

/** A message and every one of its thread, in order. */
export function threadOf(board, id) {
  const root = board.rootOf(board.byId.get(id));
  return board.messages.filter((message) => board.rootOf(message) === root);
}

/**
 * Every thread, the latest first: its first message, its last, how many, whether closed, and whom its last message
 * waits on (those it names who have not read it yet).
 */
export function threadsOf(board) {
  const roots = new Map();
  for (const message of board.messages) {
    const root = board.rootOf(message);
    if (!roots.has(root)) roots.set(root, []);
    roots.get(root).push(message);
  }
  return [...roots.entries()]
    .map(([root, list]) => {
      const last = list.at(-1);
      const named = last.to.includes("tous") ? READERS.filter((reader) => reader !== last.from) : last.to;
      const waiting = board.done.has(root) ? [] : named.filter((reader) => !board.read.has(`${last.id}|${reader}`));
      return { id: root, subject: list[0].subject, first: list[0], last, count: list.length, done: board.done.has(root), waiting };
    })
    .sort((a, b) => b.last.at.localeCompare(a.last.at));
}

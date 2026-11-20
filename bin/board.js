#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backupBoard, backupRoot, restoreBoard } from "../node/board/backup.js";
import { READERS, isFor, projectOf, threadOf, threadsOf, unreadOf } from "../node/board/board.js";
import { boardHome, createBoard } from "../node/board/store.js";
import { boardText, hookText, inboxText, threadText } from "../node/board/text.js";
import { backlogHome } from "../node/machine.js";
import { SLOT_MAX_MINUTES, SLOT_MAX_THREADS, machineLoad } from "../node/queue/slot-run.js";

/**
 * `mcts-board`: the board the Claude sessions of the mcts-* projects post to and read (Sami, 27/10/2026: five sessions,
 * news passed by copy and paste; docs/board.md). Who you are: `--as`; else, run by a Claude session, the project it
 * started in (its hook keeps it by session id); else the project of the current folder (mcts-cuisine is `cuisine`).
 * Nothing after `--` is an option: it is the body. Only Sami signs `sami` (MCTS_BOARD_SAMI=1).
 *
 *   mcts-board --post --to cuisine,entrepot --subject "…" [--reply ID] [--body-file F.md] [-- texte…]
 *   mcts-board --inbox [--json]       your unread messages, the latest first
 *   mcts-board --read ID              the message and its thread, in full; marked read for you
 *   mcts-board --done ID              its thread closed
 *   mcts-board --list [--json]        every thread, whom each waits on, the unread by reader
 *   mcts-board --hook                 for Claude Code's hooks: the unread of the session in the folder of the JSON on
 *                                     stdin (`cwd`), nothing outside a project; never fails the prompt; copies the
 *                                     board out of the library hourly, alerts when it or the library look emptied
 *   mcts-board --restore [AAAA-MM-JJ] puts back from a copy what the board lacks (node/board/backup.js)
 *
 * `--board DIR` (or MCTS_BOARD_HOME) for another board than mcts-commun's `board/`, as the tests do.
 */
const args = process.argv.slice(2);
// The options stop at `--`: what follows is a body, whatever it says (urgences, 27/10/2026: "--to sami" in a body).
const end = args.indexOf("--");
const flags = end >= 0 ? args.slice(0, end) : args;
const option = (name, fallback = null) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : fallback);
const board = createBoard(path.resolve(option("--board", boardHome())));
const json = flags.includes("--json");
/** This command, runnable from any folder: the projects have no `npx mcts-board` until their next `npm install`. */
const COMMAND = `node "${fileURLToPath(import.meta.url).replaceAll(path.sep, "/")}"`;

/** Who runs the command: `--as`; else the project its Claude session started in; else that of the current folder. */
async function whoAmI() {
  const session = process.env.CLAUDE_CODE_SESSION_ID;
  const who = option("--as") ?? (session ? await board.sessionOf(session) : null) ?? projectOf(process.cwd());
  if (!who || !READERS.includes(who)) throw new Error(`qui es-tu ? --as ${READERS.join("|")} (hors d'un dossier de projet)`);
  return who;
}

async function bodyOf() {
  if (option("--body-file")) return readFile(path.resolve(option("--body-file")), "utf8");
  return end >= 0 ? args.slice(end + 1).join(" ") : "";
}

/** Whom a reply goes to by default: the parent's author, or its recipients when one answers oneself. */
const answered = (parent, me) => (parent.from === me ? parent.to : [parent.from]);

/** A new message's recipients and subject: as given, else those of the message it answers. */
async function addressOf(me) {
  const replyTo = option("--reply");
  const parent = replyTo ? (await board.read()).byId.get(replyTo) : null;
  const to = option("--to")?.split(",").map((name) => name.trim()) ?? (parent ? answered(parent, me) : []);
  const subject = option("--subject") ?? (parent ? `Re: ${parent.subject.replace(/^Re: /, "")}` : "");
  return { to, subject, replyTo };
}

async function post() {
  const me = await whoAmI();
  if (me === "sami" && process.env.MCTS_BOARD_SAMI !== "1") throw new Error("seul Sami signe sami (MCTS_BOARD_SAMI=1 dans son terminal) ; une session signe son projet");
  const message = await board.post({ from: me, ...(await addressOf(me)), body: await bodyOf() });
  console.log(`Posté : [${message.id}] → ${message.to.join(", ")} (${message.file})`);
}

async function inbox() {
  const who = await whoAmI();
  const state = await board.read();
  console.log(json ? JSON.stringify(unreadOf(state, who).reverse(), null, 1) : inboxText(state, who, COMMAND));
}

async function readOne() {
  const who = await whoAmI();
  const id = option("--read");
  const state = await board.read();
  if (!state.byId.has(id)) throw new Error(`pas de message ${id}`);
  console.log(threadText(state, id));
  // Only what was for you: a thread read by another leaves its unread as they were (urgences, 27/10/2026).
  const mine = threadOf(state, id).filter((message) => isFor(message, who) && !state.read.has(`${message.id}|${who}`));
  await board.mark("read", mine.map((message) => message.id), who);
}

async function close() {
  const id = option("--done");
  const state = await board.read();
  if (!state.byId.has(id)) throw new Error(`pas de message ${id}`);
  const root = state.rootOf(state.byId.get(id));
  await board.mark("done", [root], await whoAmI());
  console.log(`Fil fermé : ${root}`);
}

async function list() {
  const state = await board.read();
  const threads = threadsOf(state);
  const unread = Object.fromEntries(READERS.map((reader) => [reader, unreadOf(state, reader).length]));
  console.log(json ? JSON.stringify({ threads, unread }, null, 1) : boardText(threads, unread));
}

/**
 * The project of the session `input` describes: the one kept for it, so that a cd into another project never reads its
 * mail; else the folder it started in; else that of the moment (a session started in the projects' parent folder:
 * urgences, 27/10/2026), then kept.
 */
async function sessionProject(input, remember) {
  const known = input.session_id ? await board.sessionOf(input.session_id) : null;
  if (known) return known;
  const found = projectOf(process.env.CLAUDE_PROJECT_DIR) ?? projectOf(input.cwd || process.cwd());
  if (found && input.session_id && remember) await board.rememberSession(input.session_id, found);
  return found;
}

const LIB_GIT = fileURLToPath(new URL("../.git", import.meta.url));
const exists = (file) => access(file).then(() => true, () => false);

/**
 * The board copied outside the library when its last copy is an hour old (node/board/backup.js), and the alerts when the
 * library or the board look emptied (mcts-codingame, 19/11/2026: the hook then recreated `sessions.json` in silence).
 */
async function safetyAlerts() {
  const own = path.resolve(board.home) === path.resolve(boardHome());
  const alerts = own && !(await exists(LIB_GIT)) ? [`── Alerte : mcts-commun n'a plus de .git (${path.dirname(LIB_GIT)}) : le dépôt a été vidé ? Le recloner depuis GitHub avant d'y écrire. ──`] : [];
  const root = backupRoot(board.home);
  const copy = root ? await backupBoard(board.home, root) : null;
  if (copy?.status === "shrunk") {
    const { size, last } = copy;
    alerts.push(`── Alerte : le tableau a ${size.messages} messages et ${size.journal} lignes de journal, sa copie du ${last.day} en a ${last.messages} et ${last.journal} : il a été vidé ? ${COMMAND} --restore remet ce qui manque, sans rien écraser. ──`);
  }
  return alerts;
}

/** What the hook does for the session `input` describes: the alerts, its unread shown, journaled as shown. */
async function hookFor(input) {
  const alerts = await safetyAlerts().catch(() => []);
  for (const alert of alerts) console.log(alert);
  const who = await sessionProject(input, alerts.length === 0);
  if (!who) return;
  const { text, shown } = hookText(await board.read(), who, COMMAND);
  if (text) console.log(text);
  await board.mark("shown", shown, who);
  const load = await loadLine();
  if (load) console.log(load);
}

/**
 * One line on the machine's threads while anything holds them (Sami, 27/10/2026: a session's tests beside a queue at
 * 18 of 18): how many are taken, and how to run a short test within the budget (4 threads and 15 min at most, Sami
 * 28/10/2026); nothing when all are free.
 */
async function loadLine() {
  const { used, budget, free } = await machineLoad(backlogHome());
  if (used === 0) return "";
  const advice = free > 0 ? `TEST_CONCURRENCY=${Math.min(free, SLOT_MAX_THREADS)} au plus` : "aucun fil libre : le test attendra";
  return `── Machine : ${used}/${budget} fils pris. Un test court hors file passe par les créneaux : npx mcts-backlog --slot N -- commande, ${SLOT_MAX_THREADS} fils et ${SLOT_MAX_MINUTES} min au plus ; une mesure plus longue va dans la file (${advice}). ──`;
}

/** For Claude Code's hooks: never a failed prompt, whatever happens here. */
async function hook() {
  try {
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    await hookFor(JSON.parse(raw || "{}"));
  } catch {
    // A board that cannot be read says nothing.
  }
}

/** Puts back what the copy of a day (the latest by default) has and the board lacks; overwrites nothing. */
async function restore() {
  const root = backupRoot(board.home);
  if (!root) throw new Error("ce tableau n'a pas de dossier de sauvegarde (MCTS_BOARD_BACKUP)");
  const day = flags[flags.indexOf("--restore") + 1] ?? "";
  const done = await restoreBoard(board.home, root, /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null);
  console.log(`Remis depuis la copie du ${done.from} : ${done.messages} message(s), ${done.journal} ligne(s) de journal.`);
}

const COMMANDS = { "--post": post, "--inbox": inbox, "--read": readOne, "--done": close, "--list": list, "--hook": hook, "--restore": restore };
const HELP = "usage : mcts-board --post --to X,Y --subject \"…\" [--reply ID] -- texte | --inbox | --read ID | --done ID | --list [--json] | --hook | --restore [AAAA-MM-JJ]   (docs/board.md)";

const command = Object.keys(COMMANDS).find((flag) => flags.includes(flag));
if (!command || flags.includes("--help")) {
  console.log(HELP);
  process.exit(flags.includes("--help") ? 0 : 1);
}
try {
  await COMMANDS[command]();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

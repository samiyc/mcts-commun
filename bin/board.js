#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { READERS, projectOf, threadOf, threadsOf, unreadOf } from "../node/board.js";
import { boardHome, createBoard } from "../node/board-store.js";
import { boardText, hookText, inboxText, threadText } from "../node/board-text.js";

/**
 * `mcts-board`: the board the Claude sessions of the mcts-* projects post to and read (Sami, 27/10/2026: five sessions,
 * news passed by copy and paste; docs/board.md). Who you are follows from the folder you are in (mcts-cuisine is
 * `cuisine`…), or `--as`.
 *
 *   mcts-board --post --to cuisine,entrepot --subject "…" [--reply ID] [--from X] [--body-file F.md] [-- texte…]
 *   mcts-board --inbox [--json]       your unread messages, the latest first
 *   mcts-board --read ID              the message and its thread, in full; marked read for you
 *   mcts-board --done ID              its thread closed
 *   mcts-board --list [--json]        every thread, whom each waits on, the unread by reader
 *   mcts-board --hook                 for Claude Code's hooks: the unread of the session in the folder of the JSON on
 *                                     stdin (`cwd`), nothing outside a project; never fails the prompt
 *
 * `--board DIR` (or MCTS_BOARD_HOME) for another board than mcts-commun's `board/`, as the tests do.
 */
const args = process.argv.slice(2);
const option = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const board = createBoard(path.resolve(option("--board", boardHome())));
const json = args.includes("--json");
/** This command, runnable from any folder: the projects have no `npx mcts-board` until their next `npm install`. */
const COMMAND = `node "${fileURLToPath(import.meta.url).replaceAll(path.sep, "/")}"`;

/** Who runs the command: `--as`, else the project of the current folder. */
function whoAmI() {
  const who = option("--as") ?? projectOf(process.cwd());
  if (!who || !READERS.includes(who)) throw new Error(`qui es-tu ? --as ${READERS.join("|")} (hors d'un dossier de projet)`);
  return who;
}

async function bodyOf() {
  if (option("--body-file")) return readFile(path.resolve(option("--body-file")), "utf8");
  const at = args.indexOf("--");
  return at >= 0 ? args.slice(at + 1).join(" ") : "";
}

async function post() {
  const replyTo = option("--reply");
  const parent = replyTo ? (await board.read()).byId.get(replyTo) : null;
  const to = option("--to")?.split(",").map((name) => name.trim()) ?? (parent ? [parent.from] : []);
  const subject = option("--subject") ?? (parent ? `Re: ${parent.subject.replace(/^Re: /, "")}` : "");
  const message = await board.post({ from: option("--from") ?? whoAmI(), to, subject, body: await bodyOf(), replyTo });
  console.log(`Posté : [${message.id}] → ${message.to.join(", ")} (${message.file})`);
}

async function inbox() {
  const who = whoAmI();
  const state = await board.read();
  console.log(json ? JSON.stringify(unreadOf(state, who).reverse(), null, 1) : inboxText(state, who, COMMAND));
}

async function readOne() {
  const who = whoAmI();
  const id = option("--read");
  const state = await board.read();
  if (!state.byId.has(id)) throw new Error(`pas de message ${id}`);
  console.log(threadText(state, id));
  const mine = threadOf(state, id).filter((message) => message.from !== who && !state.read.has(`${message.id}|${who}`));
  await board.mark("read", mine.map((message) => message.id), who);
}

async function close() {
  const id = option("--done");
  const state = await board.read();
  if (!state.byId.has(id)) throw new Error(`pas de message ${id}`);
  const root = state.rootOf(state.byId.get(id));
  await board.mark("done", [root], whoAmI());
  console.log(`Fil fermé : ${root}`);
}

async function list() {
  const state = await board.read();
  const threads = threadsOf(state);
  const unread = Object.fromEntries(READERS.map((reader) => [reader, unreadOf(state, reader).length]));
  console.log(json ? JSON.stringify({ threads, unread }, null, 1) : boardText(threads, unread));
}

/** For Claude Code's hooks: never a failed prompt, whatever happens here. */
async function hook() {
  try {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const who = projectOf(JSON.parse(input || "{}").cwd ?? process.cwd());
    if (!who) return;
    const { text, shown } = hookText(await board.read(), who, COMMAND);
    if (text) console.log(text);
    await board.mark("shown", shown, who);
  } catch {
    // A board that cannot be read says nothing.
  }
}

const COMMANDS = { "--post": post, "--inbox": inbox, "--read": readOne, "--done": close, "--list": list, "--hook": hook };
const HELP = "usage : mcts-board --post --to X,Y --subject \"…\" [--reply ID] -- texte | --inbox | --read ID | --done ID | --list [--json] | --hook   (docs/board.md)";

const command = Object.keys(COMMANDS).find((flag) => args.includes(flag));
if (!command || args.includes("--help")) {
  console.log(HELP);
  process.exit(args.includes("--help") ? 0 : 1);
}
try {
  await COMMANDS[command]();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

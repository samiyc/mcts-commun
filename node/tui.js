import path from "node:path";
import readline from "node:readline";
import { CSI, RESET, wrapLines } from "./ansi.js";
import { readBacklog, viewOf } from "./backlog-view.js";
import { boardView, markReadFor } from "./board-store.js";
import { stylesOf } from "./backlog-text.js";
import { tailOf } from "./tail.js";
import { pagerOf, screenOf } from "./tui-screen.js";
import { TABS, fileOf, rowsOf } from "./tui-tabs.js";

export { clip } from "./ansi.js";
export { pagerOf, screenOf } from "./tui-screen.js";
export { TABS, fileOf, rowsOf } from "./tui-tabs.js";

/**
 * `mcts-backlog --tui`: the machine's backlog in a terminal view that follows it live, after k9s and lazydocker (Sami,
 * 26/10/2026: `--list` was obscure). Read only: the runner may be at work, nothing here writes to its files; the one
 * write is the board's, l and L in the Messages tab, Sami's messages marked read through mcts-board's store. Drawn
 * with plain ANSI codes, no dependency; refreshed every 2 s.
 *
 * The screens are laid out by node/tui-screen.js (pure, tested), the tabs by node/tui-tabs.js and the panel below by
 * node/tui-detail.js; here, the keys and the drawing.
 */
const REFRESH_MS = 2_000;
const WHOLE = { lines: 5000, bytes: 2 * 1024 * 1024 };

const size = ({ stdout }) => ({ cols: stdout.columns || 120, rows: stdout.rows || 40 });
const pagerRows = (ctx) => size(ctx).rows - 2;
const rowKey = (row) => row.id ?? row.name ?? row.at;
const chosenRow = ({ view, ui }) => rowsOf(view, ui.tab, ui.filter)[ui.selected];

function draw(ctx) {
  const { view, pager, ui, stdout } = ctx;
  if (!view) return;
  const lines = pager ? pagerOf(pager, size(ctx), ui.color) : screenOf(view, ui, size(ctx));
  stdout.write(lines.map((line, i) => `${CSI}${i + 1};1H${line}`).join("") + `${CSI}J`);
  const row = chosenRow(ctx);
  if (row) ctx.chosen.set(ui.tab, rowKey(row));
}

/** The end of the chosen row's file for the panel, and the pager's file again (kept at its end when it was). */
async function loadTail(ctx) {
  const file = ctx.view && fileOf(ctx.ui.tab, chosenRow(ctx), ctx.home);
  ctx.ui.tail = file ? await tailOf(file, { lines: 60 }) : [];
  const { pager } = ctx;
  if (!pager?.file) return;
  const atEnd = pager.top >= pager.lines.length - pagerRows(ctx);
  pagerLines(ctx, await tailOf(pager.file, WHOLE));
  if (atEnd) pager.top = Math.max(0, pager.lines.length - pagerRows(ctx));
}

/** The pager's lines, kept as read (`raw`) and wrapped to the screen's width (`lines`); `raw` alone wraps them again. */
function pagerLines(ctx, raw = ctx.pager.raw) {
  Object.assign(ctx.pager, { raw, lines: wrapLines(raw, size(ctx).cols) });
  ctx.pager.top = Math.min(ctx.pager.top, Math.max(0, ctx.pager.lines.length - pagerRows(ctx)));
}

async function load(ctx) {
  if (ctx.loading) return;
  ctx.loading = true;
  const { ui } = ctx;
  try {
    ctx.view = { ...viewOf(await readBacklog(ctx.home, { budget: ctx.budget })), board: await boardView().catch(() => null) };
    // Keep the row chosen on its job when the list moves.
    const index = rowsOf(ctx.view, ui.tab, ui.filter).findIndex((row) => rowKey(row) === ctx.chosen.get(ui.tab));
    if (index >= 0) ui.selected = index;
    await loadTail(ctx);
    ui.message = "";
  } catch (error) {
    ui.message = `lecture impossible : ${error.message}`;
  } finally {
    ctx.loading = false;
  }
  draw(ctx);
}

async function choose(ctx, move) {
  move(ctx.ui);
  ctx.ui.tail = [];
  draw(ctx);
  await loadTail(ctx);
  draw(ctx);
}

/** A key's name, the aliases folded in: j k for the arrows, g and G for the ends, Tab for the arrows across. */
const ALIASES = { j: "down", k: "up" };
function keyName(text, key) {
  const name = key.name ?? text;
  if (name === "tab") return key.shift ? "left" : "right";
  if (name === "g") return key.shift ? "end" : "home";
  if (text === "G") return "end";
  return ALIASES[name] ?? name;
}

/** Where a move takes `at`, `page` a screen, `last` the end: by key name. */
const STEPS = { down: (at) => at + 1, up: (at) => at - 1, pagedown: (at, page) => at + page, pageup: (at, page) => at - page, home: () => 0, end: (_at, _page, last) => last };
const stepTo = (step, at, page, last) => Math.max(0, Math.min(last, step(at, page, last)));

async function pagerKey(ctx, { name }) {
  const { pager } = ctx;
  const step = STEPS[name === "space" ? "pagedown" : name];
  // l on a message opened from the Messages tab: its thread's messages to Sami marked read (27/10/2026).
  if (name === "l" && pager.thread) pager.note = `${await markReadFor("sami", { thread: pager.thread })} message(s) marqué(s) lu(s) pour sami`;
  else if (["q", "escape", "return"].includes(name)) ctx.pager = null;
  else if (step) Object.assign(pager, { note: "", top: stepTo(step, pager.top, pagerRows(ctx), Math.max(0, pager.lines.length - pagerRows(ctx))) });
  draw(ctx);
}

function typingKey(ctx, { raw, text }) {
  const { ui } = ctx;
  if (raw === "return") ui.typing = false;
  else if (raw === "escape") Object.assign(ui, { typing: false, filter: "" });
  else if (raw === "backspace") ui.filter = ui.filter.slice(0, -1);
  else if (text?.length === 1 && text >= " ") ui.filter += text;
  ui.selected = 0;
  return choose(ctx, () => {});
}

const tabTo = (ctx, index) => choose(ctx, (ui) => Object.assign(ui, { tab: (index + TABS.length) % TABS.length, selected: 0, offset: 0 }));

async function openPager(ctx) {
  const file = ctx.view && fileOf(ctx.ui.tab, chosenRow(ctx), ctx.home);
  if (!file) return;
  const thread = ctx.ui.tab === BOARD_TAB ? chosenRow(ctx).id : null;
  ctx.pager = { file, title: path.basename(file), thread, note: "", top: 0 };
  pagerLines(ctx, await tailOf(file, WHOLE));
  ctx.pager.top = Math.max(0, ctx.pager.lines.length - pagerRows(ctx));
  draw(ctx);
}

const BOARD_TAB = TABS.findIndex((tab) => tab.title === "Messages");

/** l: the chosen thread's messages to Sami marked read; L: all of them (Sami, 27/10/2026). Only in the Messages tab. */
async function markSami(ctx, all) {
  const row = chosenRow(ctx);
  if (ctx.ui.tab !== BOARD_TAB || (!all && !row)) return;
  const marked = await markReadFor("sami", { thread: all ? null : row.id });
  ctx.ui.message = `${marked} message(s) marqué(s) lu(s) pour sami`;
  await load(ctx);
}

const LIST_ACTIONS = {
  l: (ctx, press) => markSami(ctx, press.text === "L"),
  q: (ctx) => ctx.quit(),
  escape: (ctx) => choose(ctx, (ui) => Object.assign(ui, { help: false, filter: "" })),
  "?": (ctx) => choose(ctx, (ui) => (ui.help = !ui.help)),
  "/": (ctx) => choose(ctx, (ui) => Object.assign(ui, { typing: true, filter: "" })),
  r: (ctx) => load(ctx),
  right: (ctx) => tabTo(ctx, ctx.ui.tab + 1),
  left: (ctx) => tabTo(ctx, ctx.ui.tab - 1),
  return: (ctx) => openPager(ctx),
};

function listKey(ctx, { name, text }) {
  const action = LIST_ACTIONS[name] ?? LIST_ACTIONS[text];
  if (action) return action(ctx, { name, text });
  if (/^[1-7]$/.test(text ?? "")) return tabTo(ctx, Number(text) - 1);
  if (!STEPS[name]) return undefined;
  const count = ctx.view ? rowsOf(ctx.view, ctx.ui.tab, ctx.ui.filter).length : 0;
  const page = Math.max(3, Math.round((size(ctx).rows - 6) * 0.55));
  return choose(ctx, (ui) => (ui.selected = stepTo(STEPS[name], ui.selected, page, count - 1)));
}

function onKey(ctx, text, key = {}) {
  const press = { raw: key.name ?? text, name: keyName(text, key), text };
  if (key.ctrl && press.raw === "c") return ctx.quit();
  if (ctx.pager) return pagerKey(ctx, press);
  if (ctx.ui.typing) return typingKey(ctx, press);
  return listKey(ctx, press);
}

/** Runs the terminal view on `home` until q. */
export async function runTui({ home, budget }) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("--tui demande un terminal (essayer --list)");
  const ui = { tab: 0, selected: 0, offset: 0, filter: "", typing: false, help: false, message: "", tail: [], color: !process.env.NO_COLOR };
  const ctx = { home, budget, stdout, ui, chosen: new Map(), view: null, pager: null, loading: false };
  const restore = () => stdout.write(`${RESET}${CSI}?25h${CSI}?1049l`);
  const done = new Promise((resolve) => {
    ctx.quit = () => {
      clearInterval(timer);
      restore();
      stdin.setRawMode(false);
      stdin.pause();
      resolve();
    };
  });
  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("keypress", (text, key) => {
    Promise.resolve(onKey(ctx, text, key)).catch((error) => {
      ui.message = error.message;
      draw(ctx);
    });
  });
  stdout.on("resize", () => {
    if (ctx.pager) pagerLines(ctx);
    draw(ctx);
  });
  process.on("exit", restore);
  stdout.write(`${CSI}?1049h${CSI}?25l${CSI}2J${CSI}1;1H${stylesOf(ui.color).gray(" lecture de la backlog…")}`);
  const timer = setInterval(() => load(ctx), REFRESH_MS);
  await load(ctx);
  return done;
}


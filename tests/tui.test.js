import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { viewOf } from "../node/backlog-view.js";
import { visible, wrapLines } from "../node/ansi.js";
import { clip, pagerOf, screenOf } from "../node/tui.js";

const run = promisify(execFile);
const TUI = new URL("../node/tui.js", import.meta.url).href;
const NOW = Date.parse("2026-10-26T20:00:00");
const local = (minutesAgo) => new Date(NOW - minutesAgo * 60_000 - new Date(NOW).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

describe("the backlog's terminal view (node/tui.js, Sami 26/10: like k9s, read only)", () => {
  const view = viewOf({
    now: NOW,
    budget: 4,
    jobs: [{ id: "cuis-long", cwd: "/x/mcts-cuisine", command: "npm run compare", estimate: "1 h", status: "running", startedAt: local(30), runnerPid: 1 }, { id: "ent-next", cwd: "/x/mcts-entrepot", command: "npm run compare", estimate: "20 min", status: "todo" }],
    archive: [{ id: "urg-old", cwd: "/x/mcts-urgences", command: "npm test", estimate: "5 min", status: "failed", doneAt: local(10), minutes: 2, reason: "code 1" }],
    slots: [{ pid: 1, runner: "mcts-backlog", id: "cuis-long", threads: 1, since: new Date(NOW - 1_800_000).toISOString() }],
    journal: [
      { at: new Date(NOW).toISOString(), pid: 1, kind: "job-ended", id: "urg-old", status: "failed", minutes: 2 },
      { at: new Date(NOW - 60_000).toISOString(), pid: 7, kind: "slot-ended", id: "session:mcts-urgences:npm test", threads: 2, minutes: 0.5, code: 1 },
    ],
    wanted: [{ pid: 8, id: "session:mcts-entrepot:npm run check", threads: 4, since: new Date(NOW - 120_000).toISOString() }],
    alivePids: [1],
  });

  // The sessions' board (27/10/2026), read beside the backlog: a thread waiting on the kitchen.
  const last = { id: "2026-10-26T1950-commun-essai", at: "2026-10-26T19:50:00", from: "commun", to: ["cuisine"], subject: "Essai", file: null };
  view.board = { threads: [{ id: last.id, subject: last.subject, first: last, last, count: 1, done: false, waiting: ["cuisine"] }], unread: { cuisine: 1 } };

  it("lays every tab out on exactly the terminal's size, whatever it holds", () => {
    const board = screenOf(view, { tab: 6, selected: 0, offset: 0, filter: "", tail: [] }, { cols: 120, rows: 20 }).map(visible).join("\n");
    for (const words of ["7 Messages 1", "commun → cuisine", "attend cuisine", "npx mcts-board --read"]) assert.ok(board.includes(words), words);
    for (const [cols, rows] of [[120, 30], [60, 12], [200, 50]]) {
      for (let tab = 0; tab < 8; tab += 1) {
        const lines = screenOf(view, { tab, selected: 0, offset: 0, filter: "", tail: ["une ligne de sortie"] }, { cols, rows });
        assert.equal(lines.length, rows);
        lines.forEach((line, i) => assert.equal(visible(line).length, i === rows - 1 ? cols - 1 : cols, `onglet ${tab}, ligne ${i} : ${visible(line)}`));
      }
    }
    const running = screenOf(view, { tab: 0, selected: 0, offset: 0, filter: "", tail: [] }, { cols: 120, rows: 20 }).map(visible).join("\n");
    for (const words of ["1 En cours 1", "2 À venir 1", "4 Finis 1", "cuis-long", "30/60 min", "lanceur 1"]) assert.ok(running.includes(words), words);
    // The short tests of the slots (28/10/2026): one waiting, one ended in error.
    const tests = screenOf(view, { tab: 7, selected: 0, offset: 0, filter: "", tail: [] }, { cols: 120, rows: 20 }).map(visible).join("\n");
    for (const words of ["8 Tests 2", "◷  entrepot", "attend 2 min", "✖  urgences", "code 1", "npm run check"]) assert.ok(tests.includes(words), words);
    const finished = screenOf(view, { tab: 3, selected: 0, offset: 0, filter: "", tail: [] }, { cols: 120, rows: 20 }).map(visible).join("\n");
    assert.match(finished, /✖ +19:50 +urgences +urg-old/);
    assert.equal(screenOf(view, { tab: 0, selected: 0, offset: 0, filter: "ent-", tail: [] }, { cols: 120, rows: 20 }).map(visible)[2].includes("1 En cours 0"), true, "the filter applies");
  });

  it("cuts a coloured text on its visible characters", () => {
    assert.equal(visible(clip("\x1b[31mrouge\x1b[39m et noir", 8)), "rouge e…");
    assert.equal(clip("court", 7), "court  ");
  });

  it("wraps a message opened full screen to the terminal's width, at a space when it can (Sami, 27/10)", () => {
    const long = "Sami a demandé un moyen de se parler entre sessions sans copier-coller : voici le tableau.";
    const wrapped = wrapLines([long, "court", "\x1b[31mune sortie colorée reste entière, coupée où elle se dessine\x1b[39m"], 30);
    assert.ok(wrapped.slice(0, -2).every((line) => line.length <= 30), JSON.stringify(wrapped));
    assert.equal(wrapped.slice(0, -2).join(" "), long, "rien de perdu, les coupures aux espaces");
    assert.equal(wrapped.at(-2), "court");
    assert.equal(wrapLines(["x".repeat(65)], 30).length, 3, "un mot plus long que l'écran est coupé net");
    const screen = pagerOf({ title: "message", lines: wrapLines([long], 40), top: 0, thread: "t", note: "" }, { cols: 40, rows: 8 }, false);
    assert.ok(screen.every((line) => visible(line).length <= 40));
    assert.match(screen.at(-1), /l lu pour sami/);
  });

  it("runs on a terminal: draws, follows the keys, quits on q, writes nothing", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "tui-"));
    await mkdir(path.join(home, "runs"));
    const queue = JSON.stringify({ jobs: [{ id: "a", cwd: home, command: "x", estimate: "1 h", status: "todo" }] });
    await writeFile(path.join(home, "queue.json"), queue);
    const code = `
      Object.assign(process.stdout, { isTTY: true, columns: 100, rows: 20 });
      Object.assign(process.stdin, { isTTY: true, setRawMode: () => {} });
      const { runTui } = await import(${JSON.stringify(TUI)});
      const keys = [["2", {}], [undefined, { name: "down" }], ["/", {}], ["a", {}], [undefined, { name: "return" }], ["?", {}], ["q", { name: "q" }]];
      setTimeout(() => keys.forEach(([text, key], i) => setTimeout(() => process.stdin.emit("keypress", text, { name: key.name ?? text, ...key }), i * 30)), 300);
      await runTui({ home: ${JSON.stringify(home)}, budget: 2 });
      process.exit(0);
    `;
    const { stdout } = await run(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, MCTS_SENSORS_URL: "http://127.0.0.1:9/" }, timeout: 15_000 });
    const text = visible(stdout);
    assert.ok(stdout.startsWith("\x1b[?1049h"), "the alternate screen");
    assert.ok(stdout.endsWith("\x1b[?1049l"), "the screen given back");
    for (const words of ["1 En cours 0", "2 À venir 1", "filtre : a", "cette aide"]) assert.ok(text.includes(words), words);
    assert.equal(await readFile(path.join(home, "queue.json"), "utf8"), queue);
    assert.deepEqual((await readdir(home)).sort(), ["queue.json", "runs"]);
    await rm(home, { recursive: true, force: true });
  });
});

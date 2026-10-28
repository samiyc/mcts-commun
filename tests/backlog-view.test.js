import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { alarmsOf, durationText, listText, progressNote, warningsOf } from "../node/backlog-text.js";
import { slotsOf } from "../node/backlog-slots.js";
import { projectNight, projectOf, readBacklog, viewOf } from "../node/backlog-view.js";
import { tailOf } from "../node/tail.js";

const NOW = Date.parse("2026-10-26T20:00:00");
const stamp = (minutesAgo) => new Date(NOW - minutesAgo * 60_000 - new Date(NOW).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const job = (id, extra = {}) => ({ id, cwd: "E:\\Dev\\mcts-cuisine", command: `npm run ${id}`, estimate: "30 min", status: "todo", ...extra });

describe("what the backlog's views show (node/backlog-view.js, Sami 26/10: the backlog was a black box)", () => {
  it("projects the night as the runner plays it: side by side within the budget, after the jobs running", () => {
    const jobs = [job("run", { status: "running", startedAt: stamp(20), estimate: "30 min" }), job("a"), job("b", { threads: 2 }), job("c", { after: ["run"] })];
    const { order, waiting } = projectNight(jobs, [], 2, NOW);
    // run ends in 10 min; a fits beside it at once; b (2 threads) waits for both, and c, next in the order once run
    // is done, waits behind b, as in the runner (the next job by the order, started when its threads are free).
    assert.deepEqual(order.map(({ job: one, start }) => [one.id, (start - NOW) / 60_000]), [["a", 0], ["b", 30], ["c", 60]]);
    assert.deepEqual(waiting, []);
  });

  it("says what is blocked and why, and never plans a job past a failed prerequisite", () => {
    const { order, waiting } = projectNight([job("x", { after: ["bad"] }), job("y", { after: ["nobody"] })], [job("bad", { status: "failed", doneAt: stamp(5) })], 4, NOW);
    assert.deepEqual(order, []);
    assert.deepEqual(waiting.map(({ job: one, reason, blocked }) => [one.id, reason, blocked]), [["x", "bad : failed", true], ["y", "prérequis inconnu : nobody", true]]);
  });

  it("shows the jobs running with their progress and what is odd about them, counted from their trace (27/10)", () => {
    const state = {
      now: NOW,
      budget: 4,
      jobs: [job("long", { status: "running", startedAt: stamp(45), estimate: "30 min", runnerPid: 11, limit: 48 }), job("dead", { status: "running", startedAt: stamp(5), runnerPid: 99 }), job("next")],
      archive: [job("old", { status: "done", doneAt: stamp(120), minutes: 12 }), job("fresh", { status: "failed", doneAt: stamp(3), minutes: 1, reason: "code 3" })],
      slots: [{ pid: 11, runner: "mcts-backlog", id: "long", threads: 1, since: new Date(NOW - 3_600_000).toISOString() }],
      journal: [],
      outputs: { long: { file: "runs/x_long.txt", mtimeMs: NOW - 4 * 60_000, last: "jour 12/100" } },
      traces: [
        {
          id: "long",
          name: "x_long.jsonl",
          mtimeMs: NOW - 5 * 60_000,
          start: { at: new Date(NOW - 45 * 60_000).toISOString() },
          lastBeat: { at: new Date(NOW - 5 * 60_000).toISOString() },
          // The counters say the totals; the events kept are only the last ones.
          counters: { search: { calls: 300, slow: 3, errors: 1 }, grid: { calls: 0, overbooked: 2 } },
          problems: [{ kind: "slow" }],
          // 10 services of 30 in 40 min: 80 more, to 21:15.
          progress: { at: new Date(NOW - 5 * 60_000).toISOString(), scope: "compare", kind: "progress", done: 10, of: 30, unit: "service" },
        },
      ],
      alivePids: [11],
      machine: null,
    };
    const view = viewOf(state);
    assert.deepEqual(view.running.map((one) => one.id), ["long", "dead"]);
    const [long, dead] = view.running;
    assert.equal(long.project, "cuisine");
    assert.equal(long.over, true);
    assert.equal(long.progress, 1.5, "the fraction of its estimate, beside the progress it reported");
    assert.equal(long.lastLine, "jour 12/100");
    assert.equal(long.quietMin, 4);
    assert.deepEqual(alarmsOf(long), ["1 erreur tracée"]);
    assert.deepEqual(warningsOf(long), ["près de la limite (48 min)", "trace muette 5 min", "3 appels lents", "2 cases réservées deux fois"]);
    assert.equal(progressNote(long.reported), "service 10/30, fin vers 21:15");
    assert.deepEqual(alarmsOf(dead), ["lanceur mort"]);
    assert.deepEqual(warningsOf(dead), []);
    const idle = viewOf({ ...state, traces: [{ ...state.traces[0], counters: {}, problems: [] }] }).running[0];
    assert.deepEqual(warningsOf(idle), ["près de la limite (48 min)"], "no library call yet: its silence says nothing");
    // A trace with no end whose job ended (killed by its runner before 27/10): stopped, not silent.
    const stopped = viewOf({ ...state, traces: [{ id: "fresh", name: "x_fresh.jsonl", mtimeMs: NOW - 9 * 60_000, counters: { search: { calls: 1 } }, problems: [] }] }).traces[0];
    assert.deepEqual(stopped.stopped, { status: "failed", reason: "code 3" });
    assert.deepEqual(view.planned.map((one) => one.id), ["next"]);
    assert.deepEqual(view.finished.map((one) => one.id), ["fresh", "old"]);
    assert.deepEqual(view.threads, { used: 1, budget: 4 });
    assert.deepEqual(view.runners.map(({ pid, alive }) => [pid, alive]), [[11, true], [99, false]]);
    assert.equal(view.counts.failedToday, 1);
    // A cancellation is no failure (28/10/2026: the kitchen's 115 cancellations read "115 en échec").
    const cancelled = viewOf({ ...state, archive: [...state.archive, job("dropped", { status: "cancelled", doneAt: stamp(2), minutes: 0 })] }).counts;
    assert.deepEqual([cancelled.failedToday, cancelled.cancelledToday, cancelled.endedToday], [1, 1, 3]);
    assert.ok(listText(viewOf({ ...state, archive: [job("dropped", { status: "cancelled", doneAt: stamp(2) })] }), { color: false }).includes("0 en échec, 1 annulé"));
    const text = listText(view, { color: false });
    for (const words of ["En cours (2)", "À venir (1)", "Bloqués (0)", "Derniers finis (2)", "lanceur mort", "45/30 min", "1 erreur tracée", "service 10/30"]) assert.ok(text.includes(words), words);
  });

  it("reads a backlog's folder without writing, and an output's end without reading it all", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "backlog-view-"));
    await mkdir(path.join(home, "runs"));
    await writeFile(path.join(home, "runs", "2026-10-26-19-00_long.txt"), `${"x".repeat(300_000)}\nligne 1\r\nligne 2\rjour 12/100\n`);
    await writeFile(path.join(home, "queue.json"), JSON.stringify({ jobs: [job("long", { status: "running", startedAt: stamp(5), runnerPid: 2 ** 22 + 7 })] }));
    const state = await readBacklog(home, { now: NOW, machine: false });
    assert.equal(state.outputs.long.last, "jour 12/100", "the newest runs/*_<id>.txt, for a runner older than 26/10");
    assert.deepEqual(state.alivePids, []);
    assert.deepEqual(await tailOf(path.join(home, "runs", "2026-10-26-19-00_long.txt"), { lines: 3 }), ["ligne 1", "ligne 2", "jour 12/100"]);
    // A queue caught half written keeps its last good reading.
    await writeFile(path.join(home, "queue.json"), '{ "jobs": [');
    assert.equal((await readBacklog(home, { now: NOW, machine: false })).jobs.length, 1);
    await rm(home, { recursive: true, force: true });
  });

  it("lists the short tests of the slots: waiting, running, ended, and the jobs freed for them (Sami, 28/10)", () => {
    const at = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString();
    const tests = slotsOf({
      now: NOW,
      wanted: [{ pid: 30, id: "session:mcts-urgences:npm test", threads: 2, since: at(1) }],
      slots: [
        { pid: 1, runner: "mcts-backlog", id: "cuis-long", threads: 4, since: at(40) },
        { pid: 20, runner: "session", id: "essai", threads: 4, since: at(3) },
        { pid: 21, runner: "session", id: "session:mcts-entrepot:npm run check", threads: 1, since: at(2) },
      ],
      journal: [
        { at: at(9), pid: 10, kind: "slot-started", id: "vieux", threads: 2, waitedMin: 0.5, cwd: "E:\\Dev\\mcts-cuisine", command: "npm test" },
        { at: at(8), pid: 1, kind: "job-preempting", id: "cuis-jeune", threads: 2, wanted: 2 },
        { at: at(7), pid: 10, kind: "slot-ended", id: "vieux", threads: 2, minutes: 2, code: 3 },
        { at: at(5), pid: 11, kind: "slot-ended", id: "session:lopin:npm test", threads: 1, minutes: 1, code: 0 },
        { at: at(3), pid: 20, kind: "slot-started", id: "essai", threads: 4, waitedMin: 1.5, cwd: "E:\\Dev\\mcts-cuisine", command: "node scripts/essai.js" },
      ],
    });
    assert.deepEqual(tests.map((test) => [test.state, test.id, test.project]), [
      ["waiting", "session:mcts-urgences:npm test", "urgences"],
      ["running", "essai", "cuisine"],
      ["running", "session:mcts-entrepot:npm run check", "entrepot"],
      ["done", "session:lopin:npm test", "lopin"],
      ["failed", "vieux", "cuisine"],
      ["preempted", "cuis-jeune", ""],
    ]);
    const [waiting, running, older] = tests;
    assert.equal(Math.round(waiting.sinceMin), 1);
    assert.deepEqual([running.command, running.waitedMin, Math.round(running.sinceMin)], ["node scripts/essai.js", 1.5, 3]);
    assert.equal(older.command, "npm run check", "un --slot d'avant le 28/10 : la commande lue dans son id");
    assert.deepEqual([tests[4].code, tests[4].waitedMin, tests[4].command], [3, 0.5, "npm test"]);
  });

  it("speaks of durations and projects plainly", () => {
    assert.deepEqual([0.2, 34.4, 125, null].map(durationText), ["< 1 min", "34 min", "2 h 05", "?"]);
    assert.deepEqual(["E:\\Dev\\My projects\\mcts-entrepot", "/home/sami/lopin/"].map(projectOf), ["entrepot", "lopin"]);
  });
});

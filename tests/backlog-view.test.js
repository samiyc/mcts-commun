import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { durationText, listText, warningsOf } from "../node/backlog-text.js";
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

  it("shows the jobs running with their progress and what is odd about them", () => {
    const state = {
      now: NOW,
      budget: 4,
      jobs: [job("long", { status: "running", startedAt: stamp(45), estimate: "30 min", runnerPid: 11, limit: 48 }), job("dead", { status: "running", startedAt: stamp(5), runnerPid: 99 }), job("next")],
      archive: [job("old", { status: "done", doneAt: stamp(120), minutes: 12 }), job("fresh", { status: "failed", doneAt: stamp(3), minutes: 1, reason: "code 3" })],
      slots: [{ pid: 11, runner: "mcts-backlog", id: "long", threads: 1, since: new Date(NOW - 3_600_000).toISOString() }],
      journal: [],
      outputs: { long: { file: "runs/x_long.txt", mtimeMs: NOW - 4 * 60_000, last: "jour 12/100" } },
      traces: [{ id: "long", name: "x_long.jsonl", mtimeMs: NOW - 5 * 60_000, lastBeat: { at: new Date(NOW - 5 * 60_000).toISOString() }, counters: {}, problems: [{ kind: "slow" }] }],
      alivePids: [11],
      machine: null,
    };
    const view = viewOf(state);
    assert.deepEqual(view.running.map((one) => one.id), ["long", "dead"]);
    const [long, dead] = view.running;
    assert.equal(long.project, "cuisine");
    assert.equal(long.over, true);
    assert.equal(long.lastLine, "jour 12/100");
    assert.equal(long.quietMin, 4);
    assert.deepEqual(warningsOf(long), ["près de la limite (48 min)", "trace muette 5 min", "1 incident tracé"]);
    assert.deepEqual(warningsOf(dead), ["lanceur mort"]);
    assert.deepEqual(view.planned.map((one) => one.id), ["next"]);
    assert.deepEqual(view.finished.map((one) => one.id), ["fresh", "old"]);
    assert.deepEqual(view.threads, { used: 1, budget: 4 });
    assert.deepEqual(view.runners.map(({ pid, alive }) => [pid, alive]), [[11, true], [99, false]]);
    assert.equal(view.counts.failedToday, 1);
    const text = listText(view, { color: false });
    for (const words of ["En cours (2)", "À venir (1)", "Bloqués (0)", "Derniers finis (2)", "lanceur mort", "45/30 min"]) assert.ok(text.includes(words), words);
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

  it("speaks of durations and projects plainly", () => {
    assert.deepEqual([0.2, 34.4, 125, null].map(durationText), ["< 1 min", "34 min", "2 h 05", "?"]);
    assert.deepEqual(["E:\\Dev\\My projects\\mcts-entrepot", "/home/sami/lopin/"].map(projectOf), ["entrepot", "lopin"]);
  });
});

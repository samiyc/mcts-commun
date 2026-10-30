import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createEvents } from "../src/events.js";
import { astar, createReservations, parsePlan } from "../src/grid.js";
import { search } from "../src/mcts.js";
import { DEBUG_CAP, RING, progress, resetTrace, setTraceLevel, timed, timing, trace, traceSnapshot, traceTo } from "../src/trace.js";
import { traceFileOf } from "../node/trace-file.js";
import { doors } from "./fixtures/problems.js";

const run = promisify(execFile);
const MCTS = new URL("../src/mcts.js", import.meta.url).href;

describe("the library's trace (src/trace.js, node/trace-file.js), Sami 26/10", () => {
  it("counts and times the calls that pass through the library, and keeps their errors", () => {
    resetTrace();
    search({}, doors, { budget: 20 });
    search({}, doors, { budget: 30 });
    const plan = parsePlan("...\n.#.\n...");
    assert.ok(astar(plan, { x: 0, y: 0 }, { x: 2, y: 2 }, { passable: (char) => char !== "#" }));
    assert.equal(astar(plan, { x: 0, y: 0 }, { x: 1, y: 1 }, { passable: (char) => char !== "#" }), null);
    assert.throws(() => search({}, { ...doors, score: undefined }, { budget: 5 }), /Problem incomplet/);
    assert.throws(() => createEvents(10).schedule(3, "trop tôt"), /passé/);
    const { counters, recent } = traceSnapshot();
    assert.equal(counters.search.calls, 3);
    assert.equal(counters.search.iterations, 50);
    assert.equal(counters.search.errors, 1);
    assert.equal(counters.astar.calls, 2);
    assert.equal(counters.astar.notFound, 1);
    assert.deepEqual(recent.map((event) => [event.scope, event.kind]), [["search", "error"], ["events", "error"]]);
    assert.equal(recent[0].budget, 5);
  });

  it("wraps a function once and counts each call (timing), its errors and its this; counts bookings and clones (30/10)", () => {
    resetTrace();
    const twice = timing("twice", (n) => {
      if (n < 0) throw new Error("négatif");
      return 2 * n;
    });
    assert.equal(twice(21), 42);
    assert.throws(() => twice(-1), /négatif/);
    const scaled = { k: 3 };
    const scale = timing("scale", function scale(n) {
      return this.k * n;
    }, scaled);
    assert.equal(scale(5), 15);
    const table = createReservations();
    table.reserve("a", [{ x: 1, y: 1, t: 0 }]);
    table.clone().reserve("b", [{ x: 2, y: 1, t: 0 }]);
    createEvents().clone();
    const { counters, recent } = traceSnapshot();
    assert.deepEqual([counters.twice.calls, counters.twice.errors, counters.scale.calls], [2, 1, 1]);
    assert.ok(counters.twice.ms >= 0 && counters.twice.maxMs >= 0);
    assert.deepEqual([counters.reservations.calls, counters.reservations.clones, counters.events.clones], [2, 1, 1]);
    assert.deepEqual(recent.map((event) => [event.scope, event.kind, event.message]), [["twice", "error", "négatif"]]);
    resetTrace();
  });

  it("warns when a cell is booked over another unit (the robots that met, 23/10)", () => {
    resetTrace();
    const table = createReservations();
    table.reserve("a", [{ x: 1, y: 1, t: 3 }]);
    table.reserve("a", [{ x: 1, y: 1, t: 3 }]);
    assert.equal(traceSnapshot().counters.grid, undefined, "a unit booking its own cell again is fine");
    table.reserve("b", [{ x: 1, y: 1, t: 3 }]);
    assert.equal(traceSnapshot().counters.grid.overbooked, 1);
    assert.deepEqual(traceSnapshot().recent.map(({ kind, cell, unit, other, clone }) => ({ kind, cell, unit, other, clone })), [{ kind: "warn", cell: "1,1,3", unit: "b", other: "a", clone: false }]);
    // A search's clone says so (27/10: a kitchen's 331 cells booked twice, in its searches or in its service?).
    table.clone().reserve("c", [{ x: 1, y: 1, t: 3 }]);
    assert.equal(traceSnapshot().recent.at(-1).clone, true);
    assert.equal(traceSnapshot().counters.grid.overbooked, 2);
    assert.equal(traceSnapshot().counters.grid.overbookedInClone, 1);
  });

  /** Runs `body` with `performance.now` moving by `step()` at each read. */
  function withClock(step, body) {
    const realNow = performance.now;
    let fake = 0;
    performance.now = () => (fake += step());
    try {
      body();
    } finally {
      performance.now = realNow;
    }
  }

  it("calls slow a call over 2 s and ten times its scope's mean (27/10: 3,391 searches 'slow' of 0.5 to 6 s)", () => {
    resetTrace();
    let ms = 3000;
    withClock(() => ms, () => {
      for (let i = 0; i < 25; i += 1) timed("search", () => i);
      ms = 40_000;
      timed("search", () => 0);
    });
    assert.equal(traceSnapshot().counters.search.slow, 1, "3 s is a search's pace, not slow; 40 s is");
    assert.equal(traceSnapshot().recent.filter((event) => event.kind === "slow").at(-1).ms, 40_000);
    resetTrace();
  });

  it("says a computation's progress, its first and last always, else every 5 s at most", () => {
    resetTrace();
    let ms = 1000;
    withClock(() => ms, () => {
      progress("compare", 1, 10, { kitchen: "couloir" });
      progress("compare", 2, 10);
      ms = 6000;
      progress("compare", 3, 10);
      ms = 1;
      progress("compare", 10, 10);
    });
    assert.deepEqual(traceSnapshot().recent.map(({ kind, done, of }) => [kind, done, of]), [["progress", 1, 10], ["progress", 3, 10], ["progress", 10, 10]]);
    assert.equal(traceSnapshot().recent[0].kitchen, "couloir");
    resetTrace();
  });

  it("keeps the last events in a ring, hands them to a sink, caps debug, traces slow calls", () => {
    resetTrace();
    for (let i = 0; i < RING + 5; i += 1) trace("test", "warn", { i });
    assert.equal(traceSnapshot().recent.length, RING);
    assert.equal(traceSnapshot().recent[0].i, 5);
    const seen = [];
    const remove = traceTo((event) => seen.push(event));
    assert.equal(seen.length, RING, "a new sink gets the ring first");
    trace("test", "warn", { i: "next" });
    assert.equal(seen.at(-1).i, "next");
    remove();
    resetTrace();
    trace("test", "debug");
    assert.equal(traceSnapshot().recent.length, 0, "no debug unless asked");
    setTraceLevel("debug");
    for (let i = 0; i < DEBUG_CAP + 10; i += 1) timed("quick", () => i);
    assert.equal(traceSnapshot().counters.quick.calls, DEBUG_CAP + 10);
    assert.equal(traceSnapshot().recent.length, RING);
    setTraceLevel("off");
    const realNow = performance.now;
    let fake = 0;
    performance.now = () => (fake += 25_000);
    try {
      timed("lent", () => 1, () => ({ what: "x" }));
    } finally {
      performance.now = realNow;
    }
    assert.deepEqual(traceSnapshot().counters.lent.slow, 1);
    assert.equal(traceSnapshot().recent.at(-1).kind, "slow");
    assert.equal(traceSnapshot().recent.at(-1).what, "x");
    resetTrace();
  });

  it("writes a traced Node process to its file: start, events, heartbeat, end (MCTS_TRACE_FILE)", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "trace-"));
    const file = path.join(folder, "job.jsonl");
    const code = `
      const { search } = await import(${JSON.stringify(MCTS)});
      try { search({}, {}, { budget: 1 }); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    `;
    await run(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, MCTS_TRACE_FILE: file, MCTS_TRACE: "" } });
    const events = (await readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(events.map(({ scope, kind }) => `${scope}/${kind}`), ["process/start", "search/error", "process/heartbeat", "process/end"]);
    assert.equal(events.at(-2).counters.search.errors, 1);
    await rm(folder, { recursive: true, force: true });
  });

  it("opens a job's trace first and beats through a computation that never yields (the night of 26/10)", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "trace-"));
    const file = path.join(folder, "job.jsonl");
    const code = `
      const { search } = await import(${JSON.stringify(MCTS)});
      const problem = (await import(${JSON.stringify(new URL("./fixtures/problems.js", import.meta.url).href)})).doors;
      const until = Date.now() + 400;
      while (Date.now() < until) search({}, problem, { budget: 20 });
    `;
    const preload = `--import=${new URL("../node/trace-preload.js", import.meta.url).href}`;
    await run(process.execPath, [preload, "--input-type=module", "-e", code], { env: { ...process.env, MCTS_TRACE_FILE: file, MCTS_TRACE: "", MCTS_TRACE_BEAT_MS: "100" } });
    const events = (await readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events[0].kind, "start");
    assert.equal(events.filter((event) => event.kind === "start").length, 1, "the preload and src/trace.js open it once");
    const beats = events.filter((event) => event.kind === "heartbeat");
    assert.ok(beats.length >= 3, `${beats.length} heartbeats while it computed`);
    assert.ok(beats[0].counters.search.calls < beats.at(-1).counters.search.calls);
    await rm(folder, { recursive: true, force: true });
  });

  it("puts a hand-run trace in the project's logs/, one file a process", () => {
    const file = traceFileOf({}, "/projet", 42, new Date("2026-10-26T12:00:00Z"));
    assert.equal(file, path.join("/projet", "logs", "trace-2026-10-26-42.jsonl"));
    assert.equal(traceFileOf({ MCTS_TRACE_FILE: "x.jsonl" }, "/projet"), path.resolve("x.jsonl"));
  });
});

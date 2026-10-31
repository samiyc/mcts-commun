import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FILL_MINUTES, fillerOf } from "../node/fill.js";
import { createJournal, runnerStarts } from "../node/journal.js";
import { dropWant, inSeries, threadsNow, wantSlot } from "../node/wanted.js";

/**
 * The runner's gaps and a --slot series (Sami, 28/10/2026: 6 threads of 18 for 40 min, a 16-thread job waiting behind
 * codingame's arena while jobs of 8 threads waited behind it).
 */
const job = (id, threads, estimate = "7 min") => ({ id, threads, estimate });

describe("the gaps a waiting job leaves, and a series of tests (node/fill.js, node/wanted.js), Sami 28/10", () => {
  it("fills the gap with a short job that fits while the next waits for threads others hold", () => {
    const next = job("mondes-32", 16);
    const ready = [next, job("long", 8, "40 min"), job("diagnose-1", 8), job("diagnose-2", 8)];
    // The arena holds 6 of 18: 12 free, nothing of the runner's own running, the arena's end unknown.
    assert.equal(fillerOf({ ready, next, free: 12, budget: 18 })?.id, "diagnose-1", "a short one that fits, the long one left");
    assert.equal(fillerOf({ ready, next, free: 4, budget: 18 }), null, "nothing fits in 4");
    assert.equal(fillerOf({ ready: [next, job("court", 1, `${FILL_MINUTES + 1} min`)], next, free: 12, budget: 18 }), null, "too long to fill");
  });

  it("fills the gap behind its own jobs only with a filler that leaves the next job its start (EASY, 31/10/2026)", () => {
    const now = Date.parse("2026-10-31T01:00:00");
    const minutes = (n) => now + n * 60_000;
    // A job of 9 and a job of 1 run: 8 free of 18, the next job of 10 starts when the 9 ends, in 5 min, on 17 free.
    const next = job("mondes-10", 10);
    const running = [
      { threads: 9, end: minutes(5) },
      { threads: 1, end: minutes(19) },
    ];
    const settings = { next, free: 8, budget: 18, running, now };
    assert.equal(fillerOf({ ...settings, ready: [next, job("service", 1, "19 min")] })?.id, "service", "a 1 thread for 19 min: the 10 still fits beside it when its turn comes");
    assert.equal(fillerOf({ ...settings, ready: [next, job("diagnose", 8, "7 min")] }), null, "8 threads for 7 min: at its turn, 17 − 8 is short of 10");
    assert.equal(fillerOf({ ...settings, ready: [next, job("eclair", 8, "4 min")] })?.id, "eclair", "8 threads for 4 min: over before the next job's turn");
    assert.equal(fillerOf({ ...settings, ready: [next, job("huit", 8, "7 min"), job("un", 1, "7 min")] })?.id, "un", "the first that leaves it its start");
    assert.equal(fillerOf({ ...settings, next: job("mondes-9", 9), ready: [job("mondes-9", 9), job("diagnose", 8, "7 min")] })?.id, "diagnose", "a next job of 9: 17 − 8 is enough, no delay");
    assert.equal(fillerOf({ next: null, ready: [], free: 18, budget: 18 }), null);
  });

  it("knows a test in a series, and its want holds nothing back (codingame's arena, 28/10)", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "series-"));
    try {
      const now = Date.parse("2026-10-28T19:30:00Z");
      const ended = (minutesAgo, id = "arena") => ({ at: new Date(now - minutesAgo * 60_000).toISOString(), kind: "slot-ended", id });
      assert.equal(inSeries([ended(1)], "arena", now), true, "the same id ended a minute ago");
      assert.equal(inSeries([ended(5)], "arena", now), false, "five minutes ago: a new test");
      assert.equal(inSeries([ended(1, "other")], "arena", now), false);
      await wantSlot(home, { pid: process.pid, id: "arena", threads: 6, series: true });
      await wantSlot(home, { pid: process.pid, id: "test", threads: 2 });
      assert.equal((await threadsNow(home)).wanted, 2, "only the short test's threads are kept for it");
      await dropWant(home, process.pid, "test");
      assert.equal((await threadsNow(home)).wanted, 0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("finds a runner's start in the whole journal, its latest one (28/10: 'depuis 2 min' after 1 h 30)", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "starts-"));
    try {
      createJournal(home, { pid: 77 })("runner-started", { budget: 18 });
      createJournal(home, { pid: 78 })("job-started", { id: "x" });
      const starts = await runnerStarts(home, [77, 78]);
      assert.equal(typeof starts[77], "string");
      assert.equal(78 in starts, false, "a pid that never started as a runner");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

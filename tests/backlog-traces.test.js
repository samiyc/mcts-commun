import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readTraces, traceSummary } from "../node/backlog-traces.js";

/**
 * The traces a view shows, read cheaply (31/10/2026: 957 trace files stat'ed and thirty tailed at every tick of the TUI):
 * the newest names and the running jobs' own, a summary kept while its file does not move.
 */
const line = (kind, extra = {}) => `${JSON.stringify({ at: "2026-10-31T01:00:00.000Z", kind, ...extra })}\n`;

describe("the traces of the views (node/backlog-traces.js)", () => {
  it("shows the thirty most recent, a running job's old trace among them, and reads a summary again only when its file moved", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "traces-"));
    const folder = path.join(home, "traces");
    await mkdir(folder);
    const day = Date.parse("2026-10-30T00:00:00Z") / 1000;
    for (let i = 0; i < 90; i += 1) {
      const file = path.join(folder, `2026-10-30-${String(Math.floor(i / 60)).padStart(2, "0")}-${String(i % 60).padStart(2, "0")}_job-${i}.jsonl`);
      await writeFile(file, line("start") + line("heartbeat", { counters: { astar: { calls: i } } }));
      await utimes(file, day + i * 60, day + i * 60);
    }
    // The oldest trace belongs to a job still running: it is shown, however old its name, by its time.
    const old = path.join(folder, "2026-10-30-00-00_job-0.jsonl");
    await appendFile(old, line("heartbeat", { counters: { astar: { calls: 1000 } } }));
    await utimes(old, day + 200 * 60, day + 200 * 60);
    const shown = await readTraces(home, [], [{ id: "job-0", trace: path.join("traces", "2026-10-30-00-00_job-0.jsonl") }]);
    assert.equal(shown.length, 30);
    assert.equal(shown[0].id, "job-0", "the running job's, the most recent by its time");
    assert.deepEqual(shown[0].counters, { astar: { calls: 1000 } });
    assert.deepEqual(shown.slice(1, 4).map((one) => one.id), ["job-89", "job-88", "job-87"]);
    // The same file, unmoved: the same summary object; appended to: a new one.
    const [again] = await readTraces(home, [], [{ id: "job-0", trace: old }]);
    assert.equal(again.counters, shown[0].counters, "kept while the file does not move");
    await appendFile(old, line("heartbeat", { counters: { astar: { calls: 1001 } } }));
    await utimes(old, day + 201 * 60, day + 201 * 60);
    const [moved] = await readTraces(home, [], [{ id: "job-0", trace: old }]);
    assert.deepEqual(moved.counters, { astar: { calls: 1001 } });
    // A project's hand runs, from its logs/.
    const project = path.join(home, "projet");
    await mkdir(path.join(project, "logs"), { recursive: true });
    const hand = path.join(project, "logs", "trace-2026-10-30-99.jsonl");
    await writeFile(hand, line("start") + line("end", { status: "done" }));
    await utimes(hand, day + 300 * 60, day + 300 * 60);
    const withHand = await readTraces(home, [project], []);
    assert.deepEqual([withHand[0].file, withHand[0].ended.status], [hand, "done"]);
    assert.deepEqual((await traceSummary(hand, 0)).ended, { at: "2026-10-31T01:00:00.000Z", kind: "end", status: "done" });
    await rm(home, { recursive: true, force: true, maxRetries: 5 });
  });
});

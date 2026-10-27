import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PACE_MIN, learnedOf, pastRuns, withLearned } from "../src/estimate.js";
import { nextJob } from "../src/schedule.js";

const CUISINE = "E:/Dev/My projects/mcts-cuisine";
let day = 0;
/** A job done in `cwd`, its command, its estimate, what it took; each a day after the last. */
function done(command, estimate, minutes, extra = {}) {
  day += 1;
  return { id: `j${day}`, cwd: CUISINE, command, estimate, minutes, status: "done", doneAt: `2026-10-${String(day).padStart(2, "0")}T05:00`, ...extra };
}

describe("a job's length learned from the archive (src/estimate.js, Sami 27/10)", () => {
  it("takes the median of what the same command took, its last five runs", () => {
    const archive = [done("npm run banquet", "6 h", 400), ...[150, 160, 140, 155, 170].map((minutes) => done("npm run banquet", "6 h", minutes))];
    const job = { id: "new", cwd: CUISINE, command: "npm run banquet", estimate: "6 h" };
    assert.deepEqual(learnedOf(job, pastRuns(archive)), { minutes: 155, basis: "command", runs: 5 });
  });

  it("falls back to its project's pace, then to its own estimate", () => {
    const archive = [done("a", "1 h", 30), done("b", "2 h", 30), done("c", "40 min", 10)];
    const job = { id: "new", cwd: CUISINE, command: "npm run nouveau", estimate: "2 h" };
    // The pace: 0.5, 0.25, 0.25; the median 0.25 of 120 min.
    assert.deepEqual(learnedOf(job, pastRuns(archive)), { minutes: 30, basis: "project", runs: 3 });
    assert.equal(learnedOf(job, pastRuns(archive.slice(0, PACE_MIN - 1))), null);
    assert.equal(learnedOf({ ...job, cwd: "E:/ailleurs" }, pastRuns(archive)), null, "another folder learns nothing");
  });

  it("learns only from jobs done, on the same machine", () => {
    const archive = [done("x", "1 h", 50, { status: "failed" }), done("x", "1 h", 0), done("x", "1 h", 5, { machine: "cloud" })];
    assert.equal(learnedOf({ id: "n", cwd: CUISINE, command: "x", estimate: "1 h" }, pastRuns(archive)), null);
    assert.equal(learnedOf({ id: "n", cwd: CUISINE, command: "x", estimate: "1 h", machine: "cloud" }, pastRuns(archive)).minutes, 5);
  });

  it("hands the order the learned lengths, the given estimate kept: the shortest truly first", () => {
    const archive = [done("long", "10 min", 300), done("short", "2 h", 5)];
    const jobs = [
      { id: "l", cwd: CUISINE, command: "long", estimate: "10 min", status: "todo" },
      { id: "s", cwd: CUISINE, command: "short", estimate: "2 h", status: "todo" },
    ];
    assert.equal(nextJob(jobs, archive, 0).id, "l", "by the estimates given");
    const learned = withLearned(jobs, archive);
    assert.equal(nextJob(learned, archive, 0).id, "s");
    assert.deepEqual(learned.map(({ estimate, given, learned: how }) => ({ estimate, given, how })), [
      { estimate: "300 min", given: "10 min", how: { basis: "command", runs: 1 } },
      { estimate: "5 min", given: "2 h", how: { basis: "command", runs: 1 } },
    ]);
    assert.equal(withLearned(learned, archive)[1].given, "2 h", "learned twice, the given estimate stays");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { holdOf, indexJobs, minutesOf, nextJob, planNight, smithOrder } from "../src/schedule.js";

const NOW = Date.parse("2026-10-22T22:00");
const job = (id, estimate, extra = {}) => ({ id, command: `echo ${id}`, estimate, status: "todo", ...extra });
const ids = (jobs) => jobs.map((one) => one.id);
const next = (jobs, archive = [], now = NOW, options) => nextJob(jobs, archive, now, options)?.id;

describe("the backlog's order: prerequisites, priorities, due times (src/schedule.js, from lopin, Sami 22/10)", () => {
  it("reads the estimates the queue writes", () => {
    assert.equal(minutesOf("40 min"), 40);
    assert.equal(minutesOf("~25 min"), 25);
    assert.equal(minutesOf("1 h 30"), 90);
    assert.equal(minutesOf("≤ 2 h"), 120);
    assert.equal(minutesOf("1 à 2 h"), 120);
    assert.equal(minutesOf("30 s"), 0.5);
    assert.equal(minutesOf(undefined), 60);
  });

  it("puts the most weight a minute first, the file order between equals", () => {
    const quick = job("quick", "10 min", { priority: 1 });
    const duel = job("duel", "40 min");
    const long = job("long", "2 h", { priority: 3 });
    assert.deepEqual(ids(smithOrder([long, duel, quick])), ["quick", "duel", "long"]);
    assert.deepEqual(ids(smithOrder([job("a", "30 min"), job("b", "30 min")])), ["a", "b"]);
    // A 2 h urgent job (4 / 120) still waits behind a 40 min normal one (2 / 40).
    assert.equal(next([job("urgent", "2 h", { priority: 1 }), duel]), "duel");
    assert.equal(next([long, duel, quick], [], NOW, { fifo: true }), "long");
  });

  it("waits for `after`, counts a skipped prerequisite as finished, and blocks on a failed or unknown one", () => {
    const duel = job("duel", "40 min");
    const versus = job("versus", "1 min", { after: ["duel"] });
    assert.equal(next([duel, versus]), "duel");
    assert.equal(next([versus], [{ ...duel, status: "done" }]), "versus");
    assert.equal(next([versus], [{ ...duel, status: "skipped" }]), "versus");
    const byFailed = indexJobs([versus], [{ ...duel, status: "failed" }]);
    assert.deepEqual(holdOf(versus, byFailed, NOW), { blocked: true, reason: "duel : failed" });
    assert.deepEqual(holdOf(job("x", "1 min", { after: ["nope"] }), indexJobs([], []), NOW), { blocked: true, reason: "prérequis inconnu : nope" });
  });

  it("keeps a duel series in order through its stopIf, whatever the earlier duel's end", () => {
    const first = job("d1", "40 min");
    const second = job("d2", "20 min", { priority: 1, stopIf: [{ after: ["d1"], below: 0.47 }] });
    assert.equal(next([first, second]), "d1");
    assert.equal(next([second], [{ ...first, status: "failed" }]), "d2");
  });

  it("lets a job pass to keep its due time, only when it would miss it and can still make it", () => {
    const report = (due) => job("report", "30 min", { priority: 3, due });
    const duel = job("duel", "20 min");
    assert.equal(next([duel, report("2026-10-22T22:40")]), "report");
    // Enough slack behind the duel, or too late either way: Smith's rule.
    assert.equal(next([duel, report("2026-10-22T23:30")]), "duel");
    assert.equal(next([duel, report("2026-10-22T22:20")]), "duel");
  });

  it("does not start a scheduled job before its time", () => {
    const night = job("night", "10 min", { status: "scheduled", notBefore: "2026-10-23T01:00" });
    assert.equal(next([night]), undefined);
    assert.equal(next([night], [], Date.parse("2026-10-23T01:00")), "night");
  });

  it("plans the night with times, and says what would still wait", () => {
    const duels = [job("d1", "40 min"), job("d2", "40 min", { stopIf: [{ after: ["d1"], below: 0.47 }] })];
    const versus = job("versus", "1 min", { after: ["d1", "d2"], due: "2026-10-22T23:00" });
    const later = job("later", "10 min", { status: "scheduled", notBefore: "2026-10-23T06:00" });
    const { order, waiting } = planNight([...duels, versus, later], [], NOW);
    assert.deepEqual(ids(order.map((step) => step.job)), ["d1", "d2", "versus"]);
    assert.equal(order[2].start, NOW + 80 * 60_000);
    assert.equal(order[2].late, true);
    assert.deepEqual(waiting.map(({ job: one, reason }) => [one.id, reason]), [["later", "pas avant 2026-10-23T06:00"]]);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createEvents } from "../src/events.js";
import { paired, wilson } from "../src/measure.js";
import { createRng } from "../src/random.js";

describe("the event queue (src/events.js)", () => {
  it("gives events by time, in their scheduling order between equals, and moves the clock", () => {
    const events = createEvents();
    events.schedule(30, "c");
    events.schedule(10, "a");
    events.schedule(30, "d");
    events.schedule(10, "b");
    assert.equal(events.size, 4);
    assert.deepEqual(events.peek(), { at: 10, event: "a" });
    const seen = [];
    for (let next = events.next(); next; next = events.next()) seen.push(`${next.event}@${events.now}`);
    assert.deepEqual(seen, ["a@10", "b@10", "c@30", "d@30"]);
    assert.equal(events.next(), null);
    assert.throws(() => events.schedule(5, "late"), /passé/);
  });

  it("stays in order over many random events", () => {
    const rng = createRng(4);
    const events = createEvents();
    for (let i = 0; i < 2000; i += 1) events.schedule(Math.floor(rng.next() * 500), i);
    let last = { at: -1, event: -1 };
    for (let next = events.next(); next; next = events.next()) {
      assert.ok(next.at > last.at || (next.at === last.at && next.event > last.event));
      last = next;
    }
  });
});

describe("the measures (src/measure.js)", () => {
  it("gives Wilson's interval, inside [0, 1]", () => {
    const { rate, low, high } = wilson(55, 100);
    assert.equal(rate, 0.55);
    assert.ok(Math.abs(low - 0.452) < 0.001 && Math.abs(high - 0.644) < 0.001, `${low} – ${high}`);
    assert.deepEqual(wilson(0, 0), { rate: 0, low: 0, high: 1 });
    assert.equal(wilson(10, 10).high, 1);
  });

  it("compares two rules by pairs on the same scenarios", () => {
    const a = [3, 5, 4, 6, 5];
    const b = [2, 5, 3, 4, 6];
    const gap = paired(a, b);
    assert.equal(gap.n, 5);
    assert.equal(gap.mean, 0.6);
    assert.ok(gap.low < 0.6 && gap.high > 0.6);
    assert.deepEqual([gap.wins, gap.ties, gap.losses], [3, 1, 1]);
    assert.throws(() => paired([1], [1, 2]), /inégales/);
  });
});

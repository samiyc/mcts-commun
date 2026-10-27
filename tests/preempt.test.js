import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PREEMPT_MAX, PREEMPT_MINUTES, toPreempt } from "../node/preempt.js";

/** Which of the runner's jobs give their threads to a short test (Sami, 27/10/2026), pure: node/preempt.js. */
const NOW = Date.parse("2026-10-27T22:00:00Z");
const ago = (minutes) => NOW - minutes * 60_000;

describe("the threads a short test takes from the queue (node/preempt.js)", () => {
  it("stops the youngest jobs started less than 5 minutes ago, as many as the test lacks", () => {
    const running = [
      { id: "vieux", started: ago(PREEMPT_MINUTES + 1), threads: 4 },
      { id: "moyen", started: ago(3), threads: 1 },
      { id: "jeune", started: ago(1), threads: 1 },
      { id: "tout-jeune", started: ago(0.2), threads: 2 },
    ];
    assert.deepEqual(toPreempt({ running, missing: 2, stops: new Map(), now: NOW }), ["tout-jeune"]);
    assert.deepEqual(toPreempt({ running, missing: 3, stops: new Map(), now: NOW }), ["tout-jeune", "jeune"]);
    assert.deepEqual(toPreempt({ running, missing: 10, stops: new Map(), now: NOW }), ["tout-jeune", "jeune", "moyen"], "jamais un job de plus de 5 min");
    assert.deepEqual(toPreempt({ running, missing: 0, stops: new Map(), now: NOW }), []);
  });

  it("counts the threads already coming free, and never stops a job more than twice", () => {
    const running = [
      { id: "arrete", started: ago(0.5), threads: 2, stopping: true },
      { id: "jeune", started: ago(1), threads: 1 },
    ];
    assert.deepEqual(toPreempt({ running, missing: 2, stops: new Map(), now: NOW }), [], "les 2 fils de celui qu'on arrête suffisent");
    assert.deepEqual(toPreempt({ running, missing: 3, stops: new Map(), now: NOW }), ["jeune"]);
    assert.deepEqual(toPreempt({ running, missing: 3, stops: new Map([["jeune", PREEMPT_MAX]]), now: NOW }), [], "protégé après deux arrêts");
  });
});

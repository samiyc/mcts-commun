import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createEvents } from "../src/events.js";
import { astar, createReservations, parsePlan } from "../src/grid.js";
import { createRng } from "../src/random.js";
import { nextJob, planNight } from "../src/schedule.js";

/**
 * What the grid, the scheduler and the event queue do, hashed (Sami, 26/10/2026: taken before the lint's split,
 * after the projects' tests/fingerprint.test.js). A refactor must keep every hash; a change made on purpose
 * updates its hash in its own commit, and says why. The search's own fingerprint is in tests/api.test.js.
 */
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

const PLAN = parsePlan(["#########", "#..D....#", "#.##.##.#", "#...+...#", "#.##.##.#", "#....D..#", "#########"].join("\n"));
const passable = (char) => char !== "#";

/** Seven units planned one after the other around each other's paths, two of them parking, a shared doorway. */
function gridRuns() {
  const rng = createRng(11);
  const open = [...PLAN.find("."), ...PLAN.find("D"), ...PLAN.find("+")];
  const reservations = createReservations({ shared: PLAN.find("+") });
  const paths = [];
  for (let unit = 0; unit < 7; unit += 1) {
    const from = open[rng.int(open.length)];
    const to = open[rng.int(open.length)];
    const path = astar(PLAN, from, to, { passable, reservations, unit, start: unit, park: unit % 3 === 0 });
    if (path) reservations.reserve(unit, path, { stay: unit % 3 === 0 });
    paths.push(path);
  }
  reservations.release(2);
  const again = astar(PLAN, { x: 1, y: 1 }, { x: 7, y: 5 }, { passable, reservations, unit: 9, start: 2 });
  const blocked = astar(PLAN, { x: 1, y: 1 }, { x: 0, y: 0 }, { passable, reservations, unit: 10, horizon: 30 });
  return { paths, again, blocked };
}

const at = (hour) => Date.parse(`2026-10-26T${hour}:00`);
const QUEUE = [
  { id: "long", estimate: "2 h", status: "todo" },
  { id: "court", estimate: "20 min", status: "todo" },
  { id: "urgent", estimate: "1 h", priority: 1, status: "todo" },
  { id: "plus-tard", estimate: "30 min", priority: 3, status: "todo" },
  { id: "pour-23h", estimate: "45 min", due: "2026-10-26T23:00", status: "todo" },
  { id: "suite", estimate: "10 min", after: ["long"], status: "todo" },
  { id: "bloque", estimate: "10 min", after: ["rate"], status: "todo" },
  { id: "inconnu", estimate: "10 min", after: ["personne"], status: "todo" },
  { id: "duel-2", estimate: "1 h 30", stopIf: [{ after: ["duel-1"], below: 0.5 }], status: "todo" },
  { id: "duel-1", estimate: "1 h 30", status: "todo" },
  { id: "matin", estimate: "15 min", status: "scheduled", notBefore: "2026-10-27T06:00" },
  { id: "secondes", estimate: "90 s", status: "todo" },
];
const ARCHIVE = [{ id: "rate", status: "failed" }];

function scheduleRuns() {
  const plan = (options) => {
    const { order, waiting } = planNight(QUEUE, ARCHIVE, at("21:00"), options);
    return { order: order.map(({ job, start, end, late }) => [job.id, start, end, late]), waiting: waiting.map(({ job, blocked, reason }) => [job.id, blocked, reason]) };
  };
  return { smith: plan({}), fifo: plan({ fifo: true }), next: ["21:00", "22:30", "06:30"].map((hour) => nextJob(QUEUE, ARCHIVE, at(hour))?.id) };
}

/** A seeded storm of events: ties, a clone keeping the even ones, the clock. */
function eventRuns() {
  const rng = createRng(4);
  const queue = createEvents(0);
  const out = [];
  for (let i = 0; i < 200; i += 1) {
    queue.schedule(queue.now + rng.int(20), i);
    if (rng.next() < 0.4) out.push(queue.next());
  }
  const evens = queue.clone((event) => event % 2 === 0);
  const drain = (events) => {
    const taken = [];
    for (let next = events.next(); next; next = events.next()) taken.push([next.at, next.event]);
    return taken;
  };
  return { out, rest: drain(queue), evens: drain(evens) };
}

describe("the library's fingerprints (tests/fingerprint.test.js)", () => {
  it("keeps the grid's: the same paths, waits and parks", () => {
    assert.equal(hash(gridRuns()), "1f49a8a64427f99b");
  });

  it("keeps the scheduler's: the same night, the same reasons", () => {
    assert.equal(hash(scheduleRuns()), "7f4f51ef6881d417");
  });

  it("keeps the event queue's: the same order, ties and clones", () => {
    assert.equal(hash(eventRuns()), "6323925d91d9b490");
  });
});

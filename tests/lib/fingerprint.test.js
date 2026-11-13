import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createCmaes } from "../../src/cmaes.js";
import { createEvents } from "../../src/events.js";
import { astar, createDistances, createReservations, parsePlan } from "../../src/grid.js";
import { raceStep } from "../../src/race.js";
import { createRng } from "../../src/random.js";
import { nextJob, planNight } from "../../src/schedule.js";
import { resetTrace, traceSnapshot } from "../../src/trace.js";
import { CORRIDOR, warehouse } from "../fixtures/plans.js";

/**
 * What the grid, the scheduler and the event queue do, hashed (Sami, 26/10/2026: taken before the lint's split,
 * after the projects' tests/lib/fingerprint.test.js). A refactor must keep every hash; a change made on purpose
 * updates its hash in its own commit, and says why. The search's own fingerprint is in tests/lib/api.test.js.
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

/**
 * The options of a call of the corpus: a leg's horizon as the projects give (60 to 180 steps; at the plan's default, a
 * target parked on by another unit costs millions of nodes), parking, a short horizon, capped and partial, direct,
 * partial at a horizon.
 */
function corpusOptions(rng, kind, distances) {
  const options = { passable, start: rng.int(5), horizon: 60 + rng.int(120) };
  if (kind === 1) options.park = true;
  if (kind === 2) options.horizon = 10 + rng.int(40);
  if (kind === 3) Object.assign(options, { maxNodes: 20 + rng.int(60), partial: true });
  if (kind === 4) options.direct = distances;
  if (kind === 5) Object.assign(options, { partial: true, horizon: 25 });
  return options;
}

/**
 * A*'s corpus (30/10/2026, before A* moved onto typed arrays): 4 000 seeded calls on the bench's warehouse, a small one and
 * the corridor, ten units parked for good on each, moving units booked and released along the way, every option mixed;
 * the paths and the counters hashed. The same paths, the same nodes explored: that is what a faster A* must keep.
 */
function astarCorpus() {
  const rng = createRng(2026);
  const plans = [warehouse(40, 21), warehouse(14, 9), CORRIDOR].map((plan) => ({ plan, open: plan.find("."), distances: createDistances(plan, passable), table: createReservations() }));
  const parked = plans.flatMap((setup) => parkTen(setup, rng));
  resetTrace();
  const out = Array.from({ length: 4000 }, (_, i) => corpusCall(plans[rng.int(3)], rng, i));
  const { calls, expanded, notFound, givenUp, capped, partial, direct } = traceSnapshot().counters.astar;
  return { out: [...parked, ...out], counters: { calls, expanded, notFound, givenUp, capped, partial, direct } };
}

/** Ten units parked for good on a plan, each planned around the others: their paths' lengths. */
function parkTen({ plan, open, table }, rng) {
  const lengths = [];
  for (let unit = 0; unit < 10; unit += 1) {
    const found = astar(plan, open[rng.int(open.length)], open[rng.int(open.length)], { passable, reservations: table, unit, park: true, horizon: 80 });
    if (found) table.reserve(unit, found, { stay: true });
    lengths.push(found ? found.length : null);
  }
  return lengths;
}

/** The i-th call of the corpus on `setup`: its path as text, or null; every ninth path booked, a unit released every fiftieth call. */
function corpusCall({ plan, open, table, distances }, rng, i) {
  const options = { ...corpusOptions(rng, rng.int(6), distances), reservations: table, unit: `u${i % 7}` };
  const path = astar(plan, open[rng.int(open.length)], open[rng.int(open.length)], options);
  if (path && i % 9 === 0) table.reserve(`u${i % 7}`, path);
  if (i % 50 === 49) table.release(`u${rng.int(7)}`);
  return path ? path.map(({ x, y, t }) => `${x},${y},${t}`).join(" ") : null;
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

/** CMA-ES on a slanted valley, and a race on seeded games (13/11/2026): the numbers to 12 digits, not the last bits of a float. */
function tuningRuns() {
  const digits = (x) => Number(x.toPrecision(12));
  const valley = (x) => -x.reduce((sum, v, i) => sum + 10 ** i * (v + x[(i + 1) % x.length]) ** 2, 0);
  const es = createCmaes({ genes: 5, mean: [1, 2, 3, 4, 5], sigma: 0.5, seed: 11 });
  const best = es.run(valley, { budget: 400 });
  const rng = createRng(12);
  const results = { a: {}, b: {}, c: {} };
  for (let seed = 1; seed <= 80; seed += 1) for (const [variant, rate] of [["a", 0.6], ["b", 0.55], ["c", 0.3]]) results[variant][seed] = rng.next() < rate ? 1 : 0;
  const look = raceStep(results, ["a", "b", "c"], { looks: 4 });
  return { plan: [...best.plan].map(digits), score: digits(best.score), sigma: digits(es.sigma), look: { ...look, standings: look.standings.map((one) => ({ ...one, mean: digits(one.mean) })), dropped: look.dropped.map((one) => one.variant) } };
}

describe("the library's fingerprints (tests/lib/fingerprint.test.js)", () => {
  it("keeps the grid's: the same paths, waits and parks", () => {
    assert.equal(hash(gridRuns()), "1f49a8a64427f99b");
  });

  it("keeps A*'s corpus: 4 000 calls on three plans, the same paths and nodes explored (30/10/2026)", () => {
    const corpus = astarCorpus();
    assert.equal(corpus.counters.calls, 4000);
    assert.equal(hash(corpus), "a1e930789f48481e");
  });

  it("keeps the scheduler's: the same night, the same reasons", () => {
    assert.equal(hash(scheduleRuns()), "7f4f51ef6881d417");
  });

  it("keeps the event queue's: the same order, ties and clones", () => {
    assert.equal(hash(eventRuns()), "6323925d91d9b490");
  });

  it("keeps CMA-ES's and the race's: the same plans, the same variants dropped (13/11/2026)", () => {
    assert.equal(hash(tuningRuns()), "729caa6b7a6303f9");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadOf, morningAfter } from "../node/backlog-load.js";
import { loadText, nightText } from "../node/backlog-text.js";

// The nights are local time, the clock change of 25/10/2026 included: the tests read them as in Paris.
process.env.TZ = "Europe/Paris";
const at = (stamp) => Date.parse(stamp);
/** A done job of the archive, from `startedAt` to `doneAt` (`[start, end]`), on 1 thread, estimated at an hour. */
const job = (id, [startedAt, doneAt], minutes, extra = {}) => ({ id, status: "done", startedAt, doneAt, minutes, estimateMin: 60, threads: 1, ...extra });

describe("the machine's load (node/backlog-load.js, Sami 26/10: will 18 threads still be enough?)", () => {
  it("finds the next morning, today's before 8:00, tomorrow's after", () => {
    assert.equal(morningAfter(at("2026-10-26T22:00")), at("2026-10-27T08:00"));
    assert.equal(morningAfter(at("2026-10-27T03:00")), at("2026-10-27T08:00"));
    assert.equal(morningAfter(at("2026-10-27T08:00")), at("2026-10-28T08:00"));
  });

  it("says what the queue asks of the machine, learned from the jobs done and at its estimates, against 8:00", () => {
    const now = at("2026-10-27T06:00");
    // Their lengths learned from the archive (src/estimate.js): 60 and 120 min; they were given 2 h and 4 h.
    const running = [{ estimateMin: 60, givenMin: 120, elapsedMin: 30, threads: 2, startedAt: "2026-10-27T05:30" }];
    const planned = [{ estimateMin: 120, givenMin: 240, threads: 3 }];
    const finished = [job("a", ["2026-10-26T21:00", "2026-10-26T21:30"], 30), job("b", ["2026-10-26T21:00", "2026-10-26T21:15"], 15), job("c", ["2026-10-26T21:00", "2026-10-26T21:45"], 45)];
    const load = loadOf({ now, budget: 4, running, planned, finished, archive: finished, nightEnd: at("2026-10-27T09:30") });
    // (30 × 2 + 120 × 3) / 60 / 4 = 1.75 h of the whole machine; (90 × 2 + 240 × 3) / 60 / 4 = 3.75 h given.
    assert.equal(load.queueHours, 1.8);
    assert.equal(load.givenHours, 3.8);
    assert.equal(load.estimateRatio, 0.5);
    assert.equal(load.pastMorningMin, 90);
    assert.equal(loadText(load), "La file demande 1,8 h de la machine entière d'après les jobs déjà passés (3,8 h à ses estimations, les derniers jobs en ont pris ×0,5) ; elle finirait 1 h 30 après 8 h.");
  });

  it("measures the last nights: how busy from 20:00 to 8:00, how far past 8:00, the one under way to now", () => {
    const archive = [
      // The night of the 24th, 13 h long (the clocks went back at 3:00): two threads of four from 20:00 to 8:00 and
      // one more from 7:00, past 8:00 by 45 min: (780 × 2 + 60) / (780 × 4) = 0.519.
      job("long", ["2026-10-24T20:00", "2026-10-25T08:00"], 720, { threads: 2 }),
      job("late", ["2026-10-25T07:00", "2026-10-25T08:45"], 105),
      // A job of the day: no night.
      job("day", ["2026-10-25T14:00", "2026-10-25T15:00"], 60),
    ];
    const running = [{ startedAt: "2026-10-26T20:00", threads: 4, estimateMin: 60, elapsedMin: 60 }];
    const load = loadOf({ now: at("2026-10-26T21:00"), budget: 4, running, planned: [], finished: archive, archive, nightEnd: null });
    assert.deepEqual(
      load.nights.map(({ busy, pastMorningMin, underWay, jobs }) => ({ busy: Math.round(busy * 1000) / 1000, pastMorningMin, underWay, jobs })),
      [
        { busy: 1, pastMorningMin: 0, underWay: true, jobs: 1 },
        { busy: 0.519, pastMorningMin: 45, underWay: false, jobs: 2 },
      ],
    );
    assert.match(nightText(load.nights[1]), /^24\/10 52 %, débordée de 45 min$/);
  });
});

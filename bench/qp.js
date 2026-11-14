import { PerformanceObserver, performance } from "node:perf_hooks";
import { createQp } from "../src/qp.js";
import { createRng } from "../src/random.js";

/**
 * What the QP solver costs at its two clients' sizes (src/qp.js; reseau's request of 14/11/2026, circuit's P4):
 * - reseau, a DC dispatch of the IEEE 118's shape (54 plants, one balance row, 186 lines in both directions: 372
 *   dense rows), of RTS-GMLC's (160 plants, 240 rows), and the 118 with the preventive N-1 (68 820 rows), all LPs
 *   (PGLib's costs are linear) with flows drawn as a PTDF would give them, some lines at their limit;
 * - circuit, a minimum-curvature line: a closed second difference over 243 and 486 offsets (20 m and 10 m on a
 *   5 km track), and 175 as circuit's spline genes of P2 (40 m), each boxed by the track's width.
 * Each case solves cold, then warm after a nudge of the costs (the next hour's demand, the beam's next dispatch).
 * One line of JSON a case: milliseconds, dual steps, and the collections during the warm solves.
 * Beside the queue, under `mcts-backlog --slot 1`: `node bench/qp.js [WARM]` (20 warm solves by default).
 */
const WARM = Number(process.argv[2] ?? 20);

/** A dispatch: n plants for a demand, `lines` dense rows ±PTDF·p ≤ limit, a fifth of them at a feasible point's flow. */
function dispatch(seed, n, lines) {
  const rng = createRng(seed);
  const upper = Float64Array.from({ length: n }, () => 50 + 400 * rng.next());
  const share = 0.6;
  const p0 = Float64Array.from(upper, (v) => share * v);
  const demand = p0.reduce((sum, v) => sum + v, 0);
  const A = new Float64Array(2 * lines * n);
  const b = new Float64Array(2 * lines);
  for (let l = 0; l < lines; l += 1) {
    let flow = 0;
    for (let j = 0; j < n; j += 1) {
      const ptdf = rng.next() < 0.5 ? 0 : rng.normal() * 0.2;
      A[2 * l * n + j] = ptdf;
      A[(2 * l + 1) * n + j] = -ptdf;
      flow += ptdf * p0[j];
    }
    const limit = Math.abs(flow) + (rng.next() < 0.2 ? 0 : 50 * rng.next());
    b[2 * l] = limit;
    b[2 * l + 1] = limit;
  }
  const c = Float64Array.from({ length: n }, () => 10 + 40 * rng.next());
  return { c, eq: { A: new Float64Array(n).fill(1), b: [demand] }, le: { A, b }, lower: new Float64Array(n), upper };
}

/** A closed line of n offsets: Q the second difference's square plus a pull to the inside, the width as a box. */
function line(seed, n) {
  const rng = createRng(seed);
  const Q = new Float64Array(n * n);
  const weights = [1, -2, 1];
  for (let i = 0; i < n; i += 1) {
    for (let a = 0; a < 3; a += 1) {
      for (let b = 0; b < 3; b += 1) Q[((i + a) % n) * n + ((i + b) % n)] += weights[a] * weights[b];
    }
  }
  const c = Float64Array.from({ length: n }, (_, i) => Math.sin((6 * Math.PI * i) / n) * 0.2 + 0.01 * rng.normal());
  return { Q, c, lower: new Float64Array(n).fill(-1), upper: new Float64Array(n).fill(1) };
}

/** WARM solves, each after a nudge of the costs and warmed by the last: their mean time and steps, and statuses. */
function warmRuns(qp, problem, cold) {
  let steps = 0;
  let last = cold;
  const statuses = new Set();
  const start = performance.now();
  for (let k = 1; k <= WARM; k += 1) {
    const nudged = { ...problem, c: Float64Array.from(problem.c, (v, i) => v * (1 + 0.002 * Math.sin(k + i))) };
    last = qp.solve(nudged, { warm: last.active });
    steps += last.iterations;
    statuses.add(last.status);
  }
  return { warmMs: (performance.now() - start) / WARM, steps: steps / WARM, statuses, last };
}

function measure(name, problem) {
  const n = problem.c.length;
  const qp = createQp(n);
  const start = performance.now();
  const cold = qp.solve(problem);
  const coldMs = performance.now() - start;
  const collections = [];
  const observer = new PerformanceObserver((list) => collections.push(...list.getEntries()));
  observer.observe({ entryTypes: ["gc"] });
  const { warmMs, steps, statuses, last } = warmRuns(qp, problem, cold);
  observer.disconnect();
  const binding = last.active.le.length + last.active.lower.length + last.active.upper.length;
  const out = { case: name, n, rows: problem.le?.b.length ?? 0, status: cold.status, warmStatus: [...statuses].join(","), rounds: last.rounds, coldMs: +coldMs.toFixed(2), coldSteps: cold.iterations, warmMs: +warmMs.toFixed(3), warmSteps: +steps.toFixed(1), binding, collections: collections.length };
  console.log(JSON.stringify(out));
}

measure("ieee118-dispatch", dispatch(118, 54, 186));
measure("rts-gmlc-dispatch", dispatch(73, 160, 120));
measure("ieee118-n-1", dispatch(1181, 54, 34_410));
measure("circuit-175", line(175, 175));
measure("circuit-243", line(243, 243));
measure("circuit-486", line(486, 486));

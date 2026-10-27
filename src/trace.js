/**
 * What passes through the library, kept so that a run that stalls or fails can be read afterwards (Sami, 26/10/2026:
 * the common trunk was a black box). Pure, for the page and for Node alike: counters by scope (calls, milliseconds,
 * the slowest, errors), the last events in a ring, and sinks that receive each event as it comes.
 *
 * What is an event: an `error` (traced, then thrown again as before), a `warn` (something the library survived but
 * should not see: two units booked on one cell), a `slow` call, a project's `progress` (`progress`), and with
 * `MCTS_TRACE=debug` every call (`debug`, the first `DEBUG_CAP` of a scope). Counters cost an addition: always on.
 *
 * A slow call is over `SLOW_MS` and over `SLOW_FACTOR` times the mean of its scope's calls before it (a first call,
 * `SLOW_FACTOR` times `SLOW_MS`). 27/10/2026: a kitchen's searches take 0.5 to 6 s each; over 2 s alone, 3,391 of them
 * were "slow" in one morning, the views showed twenty incidents on every job and would have hidden a real one; by this
 * rule, 13 (a search of 38 s where they took 1.5 s).
 *
 * Under Node, with `MCTS_TRACE` (1, on, debug) or `MCTS_TRACE_FILE` set, the file sink (node/trace-file.js) is
 * loaded by a dynamic import: no static `node:*` here, the page loads this module unchanged. That import ends only
 * when the process first yields: a backlog job loads the sink before its modules (node/trace-preload.js).
 */
export const RING = 200;
export const SLOW_MS = 2000;
export const DEBUG_CAP = 1000;
const SLOW_FACTOR = 10;
const PROGRESS_MS = 5000;

const env = globalThis.process?.env ?? {};
function levelOf(value) {
  if (value === "debug") return "debug";
  return value && value !== "0" && value !== "off" ? "on" : "off";
}
const state = { level: levelOf(env.MCTS_TRACE || (env.MCTS_TRACE_FILE ? "on" : "")), since: Date.now(), counters: new Map(), recent: [], sinks: new Set(), debugs: new Map(), pulses: new Map(), progress: new Map() };
const clock = () => globalThis.performance?.now() ?? Date.now();

/** Calls each pulse whose time has come, from within the library's calls. */
function pulse(now) {
  if (state.pulses.size === 0) return;
  for (const [beat, timing] of state.pulses) {
    if (now - timing.last < timing.everyMs) continue;
    timing.last = now;
    beat();
  }
}

/** The trace level: "off" (counters and ring only), "on" (a sink writes them), "debug" (every call too). */
export const traceLevel = () => state.level;
export function setTraceLevel(level) {
  state.level = levelOf(level);
}

/** The counters of `scope`, made on first use. */
function countersOf(scope) {
  if (!state.counters.has(scope)) state.counters.set(scope, { calls: 0, ms: 0, maxMs: 0, errors: 0, slow: 0 });
  return state.counters.get(scope);
}

/** Whether a call of `ms` is slow for `counters` (its scope's, this call counted). */
function isSlow(counters, ms) {
  const before = counters.calls > 1 ? (counters.ms - ms) / (counters.calls - 1) : SLOW_MS;
  return ms > SLOW_MS && ms > SLOW_FACTOR * before;
}

/** Adds `n` to counter `name` of `scope`. */
export function count(scope, name, n = 1) {
  const counters = countersOf(scope);
  counters[name] = (counters[name] ?? 0) + n;
}

/** Records an event `{ at, scope, kind, ...data }`: kept in the ring, handed to every sink. */
export function trace(scope, kind, data = {}) {
  if (kind === "debug") {
    if (state.level !== "debug") return;
    const seen = (state.debugs.get(scope) ?? 0) + 1;
    state.debugs.set(scope, seen);
    if (seen > DEBUG_CAP) return;
  }
  const event = { at: new Date().toISOString(), scope, kind, ...data };
  state.recent.push(event);
  if (state.recent.length > RING) state.recent.shift();
  for (const sink of state.sinks) sink(event);
}

/**
 * Runs `run()` as a call of `scope`: counted and timed; a slow call or an error traced with `details()` (read only
 * then), the error thrown again.
 */
export function timed(scope, run, details = () => ({})) {
  const counters = countersOf(scope);
  const begin = clock();
  counters.calls += 1;
  try {
    return run();
  } catch (error) {
    counters.errors += 1;
    trace(scope, "error", { message: error.message, stack: error.stack, ...details() });
    throw error;
  } finally {
    const end = clock();
    const ms = end - begin;
    counters.ms += ms;
    if (ms > counters.maxMs) counters.maxMs = ms;
    if (isSlow(counters, ms)) {
      counters.slow += 1;
      trace(scope, "slow", { ms: Math.round(ms), ...details() });
    } else if (state.level === "debug") trace(scope, "debug", { ms: Math.round(ms * 1000) / 1000, ...details() });
    pulse(end);
  }
}

/**
 * Says how far a project's computation is (Sami, 27/10/2026: a job's output was silent for 45 minutes): `done` of
 * `of` (services, scenarios, waves), traced as `progress` at most every `PROGRESS_MS` by scope, its first and its
 * last always. The backlog's views show the last, and when the job should end at its pace.
 */
export function progress(scope, done, of, details = {}) {
  const now = clock();
  const last = state.progress.get(scope);
  const edge = last === undefined || done >= of;
  if (edge || now - last >= PROGRESS_MS) {
    state.progress.set(scope, now);
    trace(scope, "progress", { done, of, ...details });
  }
  pulse(now);
}

/**
 * Calls `beat()` at most every `everyMs` from the library's calls (node/trace-file.js: the heartbeat). A synchronous
 * computation never lets a timer fire (27/10: a night's job traced only at its end): its calls beat for it.
 * Returns what removes it.
 */
export function onPulse(beat, everyMs) {
  state.pulses.set(beat, { everyMs, last: clock() });
  return () => state.pulses.delete(beat);
}

/** Hands every event to `sink(event)` from now on, the ring's first; returns what removes it. */
export function traceTo(sink) {
  for (const event of state.recent) sink(event);
  state.sinks.add(sink);
  return () => state.sinks.delete(sink);
}

/** What the trace holds: `{ since, level, counters: { scope: { calls, ms, maxMs, errors, slow, … } }, recent }`. */
export function traceSnapshot() {
  const round = (value) => Math.round(value * 10) / 10;
  const counters = Object.fromEntries([...state.counters].map(([scope, one]) => [scope, { ...one, ms: round(one.ms), maxMs: round(one.maxMs) }]));
  return { since: new Date(state.since).toISOString(), level: state.level, counters, recent: [...state.recent] };
}

/** Forgets the counters, the ring and the sinks (tests). */
export function resetTrace() {
  state.counters.clear();
  state.recent.length = 0;
  state.sinks.clear();
  state.debugs.clear();
  state.pulses.clear();
  state.progress.clear();
  state.since = Date.now();
}

if (globalThis.process?.versions?.node && state.level !== "off") {
  import("../node/trace-file.js").then(({ traceToFile }) => traceToFile()).catch((error) => globalThis.console.error(`[mcts-commun] trace : ${error.message}`));
}

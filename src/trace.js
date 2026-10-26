/**
 * What passes through the library, kept so that a run that stalls or fails can be read afterwards (Sami, 26/10/2026:
 * the common trunk was a black box). Pure, for the page and for Node alike: counters by scope (calls, milliseconds,
 * the slowest, errors), the last events in a ring, and sinks that receive each event as it comes.
 *
 * What is an event: an `error` (traced, then thrown again as before), a `warn` (something the library survived but
 * should not see: two units booked on one cell), a `slow` call (over `SLOW_MS`), and with `MCTS_TRACE=debug` every
 * call (`debug`, the first `DEBUG_CAP` of a scope). Counters cost an addition: they are always on.
 *
 * Under Node, with `MCTS_TRACE` (1, on, debug) or `MCTS_TRACE_FILE` set, the file sink (node/trace-file.js) is
 * loaded by a dynamic import: no static `node:*` here, the page loads this module unchanged.
 */
export const RING = 200;
export const SLOW_MS = 2000;
export const DEBUG_CAP = 1000;

const env = globalThis.process?.env ?? {};
const levelOf = (value) => (value === "debug" ? "debug" : value && value !== "0" && value !== "off" ? "on" : "off");
const state = { level: levelOf(env.MCTS_TRACE || (env.MCTS_TRACE_FILE ? "on" : "")), since: Date.now(), counters: new Map(), recent: [], sinks: new Set(), debugs: new Map() };
const clock = () => globalThis.performance?.now() ?? Date.now();

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
    const ms = clock() - begin;
    counters.ms += ms;
    if (ms > counters.maxMs) counters.maxMs = ms;
    if (ms > SLOW_MS) {
      counters.slow += 1;
      trace(scope, "slow", { ms: Math.round(ms), ...details() });
    } else if (state.level === "debug") trace(scope, "debug", { ms: Math.round(ms * 1000) / 1000, ...details() });
  }
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
  state.since = Date.now();
}

if (globalThis.process?.versions?.node && state.level !== "off") {
  import("../node/trace-file.js").then(({ traceToFile }) => traceToFile()).catch((error) => console.error(`[mcts-commun] trace : ${error.message}`));
}

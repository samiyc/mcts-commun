import { projectOf } from "./backlog-view.js";

/**
 * The short tests beside the queue (Sami, 28/10/2026: show the quick tests that pass through --slot, before the queue's
 * jobs): those waiting for threads (wanted.json), those holding them (the sessions' slots in slots.json), and those
 * ended lately (the journal's slot-ended), the jobs the queue freed for them among these (job-preempting). Pure.
 */
const ENDED_SHOWN = 30;
const minutesBetween = (from, to) => Math.max(0, (to - Date.parse(from)) / 60_000);
// The journal's instants are UTC; the views' stamps are local, as the queue's ("2026-10-28T18:31").
const localStamp = (iso) => new Date(Date.parse(iso) - new Date(Date.parse(iso)).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** The project and command a default id holds: `session:<folder>:<command>` (bin/backlog.js), else nothing. */
function fromId(id = "") {
  const match = /^session:([^:]*):(.*)$/.exec(id);
  return match ? { project: projectOf(match[1]), command: match[2] } : { project: "?", command: "" };
}

/** Where and what a test runs: its slot-started line, else what its id says. */
function namedOf(started, id) {
  if (!started) return fromId(id);
  return { project: projectOf(started.cwd), command: started.command ?? "" };
}

/** The last journal line of `kind` for process `pid` and test `id`, before `before` when given. */
function lastOf(journal, kind, { pid, id, before = Infinity }) {
  return journal.findLast((entry) => entry.kind === kind && entry.pid === pid && entry.id === id && Date.parse(entry.at) <= before);
}

const waitingOf = (now) => (want) => ({ state: "waiting", pid: want.pid, id: want.id, threads: want.threads, sinceMin: minutesBetween(want.since, now), ...fromId(want.id) });

function runningOf(now, journal) {
  return (slot) => {
    const started = lastOf(journal, "slot-started", slot);
    return { state: "running", pid: slot.pid, id: slot.id, threads: slot.threads, sinceMin: minutesBetween(slot.since, now), waitedMin: started?.waitedMin ?? null, ...namedOf(started, slot.id) };
  };
}

function endedOf(journal) {
  return (entry) => {
    const started = lastOf(journal, "slot-started", { pid: entry.pid, id: entry.id, before: Date.parse(entry.at) });
    const state = entry.code === 0 ? "done" : "failed";
    return { state, pid: entry.pid, id: entry.id, threads: entry.threads, minutes: entry.minutes, code: entry.code, at: entry.at, stamp: localStamp(entry.at), waitedMin: started?.waitedMin ?? null, ...namedOf(started, entry.id) };
  };
}

const preemptedOf = (entry) => ({ state: "preempted", pid: entry.pid, id: entry.id, threads: entry.threads, at: entry.at, stamp: localStamp(entry.at), wanted: entry.wanted ?? null, project: "", command: "" });

/** The tests waiting, then running, then ended lately with the jobs freed for them, the latest first. */
export function slotsOf({ now, slots = [], wanted = [], journal = [] }) {
  const ended = [
    ...journal.filter((entry) => entry.kind === "slot-ended").map(endedOf(journal)),
    ...journal.filter((entry) => entry.kind === "job-preempting").map(preemptedOf),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, ENDED_SHOWN);
  const waiting = wanted.map(waitingOf(now)).sort((a, b) => b.sinceMin - a.sinceMin);
  const running = slots
    .filter((slot) => slot.runner === "session")
    .map(runningOf(now, journal))
    .sort((a, b) => b.sinceMin - a.sinceMin);
  return [...waiting, ...running, ...ended];
}

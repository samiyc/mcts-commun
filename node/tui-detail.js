import { alarmsOf, clockText, durationText, fit, maybe, progressNote, relativeText, stampText, statusOf, warningsOf } from "./backlog-text.js";
import { kindOf, localTime, traceState } from "./tui-tabs.js";

/**
 * The panel below the terminal view's table (node/tui.js): what it says of the row chosen, one function a tab, then
 * the end of its output or trace. Pure.
 */
const fieldOf = (s) => (name, value) => (value === null || value === undefined || value === "" ? [] : [`${s.gray(fit(name, 10))} ${value}`]);

function runningDetail(row, field, { view, s }) {
  const since = `${stampText(row.startedAt, view.now)} · ${durationText(row.elapsedMin)} sur ${durationText(row.estimateMin)} estimées · limite ${durationText(row.limitMin)}`;
  const processes = `lanceur ${row.runnerPid ?? "?"}${row.orphan ? s.red(" (mort)") : ""}${maybe(row.childPid, " · job ")}`;
  const written = row.quietMin === null ? "" : s.gray(" · écrite " + relativeText(view.now - row.quietMin * 60_000, view.now));
  const beat = row.beatMin === null ? s.gray("aucune (lanceur d'avant le 26/10, ou job sans la bibliothèque)") : `dernier battement ${relativeText(view.now - row.beatMin * 60_000, view.now)}`;
  const [alarms, warnings] = [alarmsOf(row).join(", "), warningsOf(row).join(", ")];
  const said = [...field("sortie", row.output ? row.output + written : null), ...field("trace", beat), ...field("avancement", progressNote(row.reported))];
  return [...field("depuis", since), ...field("processus", processes), ...said, ...field("alarme", alarms && s.red(alarms)), ...field("attention", warnings && s.yellow(warnings))];
}

function plannedDetail(row, field, { s }) {
  const late = row.late ? s.red(" en retard sur son échéance") : "";
  return [...field("prévu", `${clockText(row.start)} → ${clockText(row.end)} (${durationText(row.estimateMin)})${late}`), ...field("échéance", row.due), ...field("après", row.after.join(", ")), ...field("priorité", row.priority)];
}

const blockedDetail = (row, field, { s }) => [...field("pourquoi", row.blocked ? s.red(row.reason) : row.reason), ...field("après", row.after.join(", "))];

function finishedDetail(row, field, { view, s }) {
  const status = statusOf(row.status);
  const end = `${s[status.color](status.icon + " " + status.word)} ${stampText(row.doneAt, view.now)} · ${durationText(row.minutes)} (estimé ${durationText(row.estimateMin)})`;
  return [...field("fin", end), ...field("raison", row.reason && s.red(row.reason)), ...field("sortie", row.output), ...field("trace", row.trace)];
}

function journalDetail(row, field, { s }) {
  const [word, color] = kindOf(row.kind);
  const values = Object.entries(row).filter(([key]) => !["at", "kind", "pid"].includes(key));
  return [`${s[color](s.bold(word))}  ${s.gray(localTime(row.at))} ${s.gray("pid " + row.pid)}`, ...values.flatMap(([key, value]) => field(key, typeof value === "object" ? JSON.stringify(value) : value))];
}

const COUNTED = new Set(["calls", "ms", "maxMs", "errors", "slow"]);

/** A scope's counters in a line: calls, time, the longest, errors, slow ones, and what else it counts. */
function scopeText(one, s) {
  const extra = Object.entries(one)
    .filter(([key]) => !COUNTED.has(key))
    .map(([key, value]) => `${key} ${value}`)
    .join(", ");
  const errors = one.errors ? s.red(` · ${one.errors} erreur(s)`) : "";
  const slow = one.slow ? s.yellow(` · ${one.slow} lent(s)`) : "";
  return `${one.calls} appels · ${durationText(one.ms / 60_000)} · le plus long ${Math.round(one.maxMs)} ms${errors}${slow}${extra ? s.gray(" · " + extra) : ""}`;
}

function problemText(problem, s) {
  return `${s.gray(localTime(problem.at))} ${problem.kind === "slow" ? s.yellow("lent") : s.red(problem.kind)} ${problem.scope} ${problem.message ?? ""}${problem.ms ? " " + problem.ms + " ms" : ""}`;
}

function traceDetail(row, field, { s }) {
  const started = row.start ? `${localTime(row.start.at)} · ${(row.start.argv ?? []).join(" ")}` : null;
  const rss = row.lastBeat?.rssMb ? " · " + row.lastBeat.rssMb + " Mo" : "";
  const beat = row.lastBeat ? localTime(row.lastBeat.at) + rss : null;
  return [
    `${s.bold(row.id ?? row.name)}  ${traceState(row, s)}`,
    ...field("fichier", row.file),
    ...field("lancé", started),
    ...field("battement", beat),
    ...Object.entries(row.counters ?? {}).flatMap(([scope, one]) => field(scope, scopeText(one, s))),
    ...row.problems.slice(-8).map((problem) => problemText(problem, s)),
  ];
}

/** @type {Array<(row: any, field: (name: string, value: any) => string[], context: { view: any, s: any }) => string[]>} */
const DETAILS = [runningDetail, plannedDetail, blockedDetail, finishedDetail, journalDetail, traceDetail];

/** What the panel below the table says of `row` in tab `index`, as lines; `tail` is the end of its output or trace. */
export function detailOf(index, row, { view, s, tail }) {
  if (!row) return [s.gray("Rien à montrer ici.")];
  const field = fieldOf(s);
  const head = index <= 3 ? [`${s.bold(row.id)}  ${s.gray(row.project)}`, ...field("commande", row.command), ...field("dossier", row.cwd)] : [];
  const end = tail?.length ? [s.gray(`── fin de ${index === 5 ? "la trace" : "la sortie"} ${"─".repeat(40)}`), ...tail.map((line) => s.gray(line))] : [];
  return [...head, ...DETAILS[index](row, field, { view, s }), ...end];
}

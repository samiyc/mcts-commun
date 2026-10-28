import { CSI } from "./ansi.js";

/**
 * The backlog in a terminal's words (Sami, 26/10/2026: `--list` was obscure): durations, clocks, bars, the colours of
 * a status, and `listText`, what `mcts-backlog --list` prints. The terminal view (node/tui.js) draws with the same.
 */
const CODES = { bold: [1, 22], dim: [2, 22], inverse: [7, 27], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39], gray: [90, 39], white: [97, 39] };

/** Styles as functions (`styles.red("x")`); plain text when `enabled` is false. */
export function stylesOf(enabled) {
  return Object.fromEntries(Object.entries(CODES).map(([name, [on, off]]) => [name, (text) => (enabled ? `${CSI}${on}m${text}${CSI}${off}m` : String(text))]));
}

/** Colours wanted on `stream`: a terminal, and no NO_COLOR. */
export const colorsOn = (stream = process.stdout, env = process.env) => Boolean(stream.isTTY) && !env.NO_COLOR;

export const STATUS = {
  running: { icon: "▶", color: "cyan", word: "en cours" },
  todo: { icon: "·", color: "gray", word: "à faire" },
  scheduled: { icon: "◷", color: "gray", word: "programmé" },
  done: { icon: "✔", color: "green", word: "fait" },
  failed: { icon: "✖", color: "red", word: "échec" },
  timeout: { icon: "⧗", color: "yellow", word: "trop long" },
  skipped: { icon: "↷", color: "gray", word: "sauté" },
  cancelled: { icon: "⊘", color: "yellow", word: "annulé" },
};
export const statusOf = (status) => STATUS[status] ?? { icon: "?", color: "white", word: status };

/** `before` + `text` when there is a text, else nothing: the optional bits of a line. */
export const maybe = (text, before = " ") => (text ? before + text : "");
/** "(text)" after a space, or nothing. */
export const paren = (text) => (text ? ` (${text})` : "");
/** `word` with an s past one. */
export const plural = (n, word) => (n > 1 ? `${word}s` : word);

/** "< 1 min", "34 min", "2 h 05". */
export function durationText(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "?";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const whole = Math.round(minutes);
  return `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, "0")}`;
}

/** "18:40" in local time. */
export const clockText = (ms) => (Number.isFinite(ms) ? new Date(ms).toTimeString().slice(0, 5) : "--:--");

/** "dans 25 min", "il y a 3 min". */
export function relativeText(ms, now) {
  const minutes = (ms - now) / 60_000;
  return minutes >= 0 ? `dans ${durationText(minutes)}` : `il y a ${durationText(-minutes)}`;
}

/** A local stamp ("2026-10-26T18:57") as "26/10 18:57", or "18:57" on `now`'s day. */
export function stampText(stamp, now = Date.now()) {
  if (!stamp) return "?";
  const day = new Date(now - new Date(now).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return stamp.startsWith(day) ? stamp.slice(11, 16) : `${stamp.slice(8, 10)}/${stamp.slice(5, 7)} ${stamp.slice(11, 16)}`;
}

/** A bar `width` wide, `fraction` of it full (clipped to 1). */
export function bar(fraction, width) {
  const full = Math.max(0, Math.min(width, Math.round((Number.isFinite(fraction) ? fraction : 0) * width)));
  return "█".repeat(full) + "░".repeat(width - full);
}

/** `text` cut with an ellipsis or padded to `width` characters (plain text, no colour codes). */
export function fit(text, width, align = "left") {
  const plain = String(text ?? "").replace(/[\r\n\t]+/g, " ");
  if (width <= 0) return "";
  const cut = plain.length > width ? `${plain.slice(0, Math.max(0, width - 1))}…` : plain;
  return align === "right" ? cut.padStart(width) : cut.padEnd(width);
}

const decimal = (value) => String(value).replace(".", ",");

/** A runner in a few words: alive or not, its pid, since when. */
function runnerText(one, view, s) {
  const since = one.since ? durationText((view.now - Date.parse(one.since)) / 60_000) : "";
  const waits = one.waiting ? s.yellow(`, attend ${one.waiting.threads} fils pour ${one.waiting.id} (${one.waiting.free} libres)`) : "";
  return `${one.alive ? s.green("●") : s.red("○")} ${one.runner} ${one.pid}${maybe(since, " depuis ")}${waits}`;
}

/** The machine in one line: runners, threads, CPU, memory. */
export function machineLine(view, s) {
  const runners = view.runners.length ? view.runners.map((one) => runnerText(one, view, s)).join("  ") : `${s.gray("○")} aucun lanceur`;
  const { used, budget } = view.threads;
  const machine = view.machine;
  const cpu = machine?.cpu ? `CPU ${decimal(machine.cpu.celsius)} °C` : "CPU ?";
  const hot = machine?.cpu && machine.cpu.celsius >= 85 ? s.red(cpu) : cpu;
  const ram = machine ? `RAM ${decimal(machine.freeGb)}/${decimal(machine.totalGb)} Go libres` : "";
  return [runners, `fils ${s.cyan(bar(used / budget, 10))} ${used}/${budget}`, hot, ram].filter(Boolean).join(s.gray("  ·  "));
}

/** A running job's progress: "██████░░░░ 34/45 min", in yellow past its estimate. */
export function progressText(job, s, width = 10) {
  const text = `${bar(job.progress, width)} ${Math.round(job.elapsedMin)}/${Math.round(job.estimateMin)} min`;
  return job.over ? s.yellow(text) : s.cyan(text);
}

/** What must not happen to a job (or its trace): its runner gone, a crash, errors traced. */
export function alarmsOf(job) {
  const errors = job.incidents?.errors ?? 0;
  return [job.orphan ? "lanceur mort" : "", job.incidents?.crashed ? "planté" : "", errors ? `${errors} ${plural(errors, "erreur")} ${plural(errors, "tracée")}` : ""].filter(Boolean);
}

/** What a trace counted that is worth a look: slow calls (src/trace.js), cells booked twice (src/grid.js). */
export function noticesOf(incidents) {
  const { slow = 0, overbooked = 0 } = incidents ?? {};
  return [slow ? `${slow} ${plural(slow, "appel")} ${plural(slow, "lent")}` : "", overbooked ? `${overbooked} ${plural(overbooked, "case")} ${plural(overbooked, "réservée")} deux fois` : ""].filter(Boolean);
}

/**
 * What is odd about a running job, short of an alarm: near its limit, its trace silent (a heartbeat comes every 30 s:
 * two minutes without one is a computation stuck in a loop), what its trace counted. A silent output says little: most
 * measures write theirs at the end, unless they say their progress.
 */
export function warningsOf(job) {
  const silent = job.beatMin !== null && job.beatMin >= 2 ? `trace muette ${durationText(job.beatMin)}` : "";
  return [job.elapsedMin > job.limitMin * 0.9 ? `près de la limite (${job.limitMin} min)` : "", silent, ...noticesOf(job.incidents)].filter(Boolean);
}

/** A running job's notes, each led by two spaces: its alarms in red, its progress, its warnings in yellow. */
export function notesText(job, s) {
  const notes = [[alarmsOf(job).join(", "), s.red], [progressNote(job.reported), (text) => text], [warningsOf(job).join(", "), s.yellow]];
  return notes.map(([text, style]) => (text ? "  " + style(text) : "")).join("");
}

/** A computation's progress (src/trace.js `progress`): "service 12/30, fin vers 10:20", or "". */
export function progressNote(progress) {
  if (!progress) return "";
  const end = progress.endAt !== null && progress.done < progress.of ? `, fin vers ${clockText(Date.parse(progress.endAt))}` : "";
  return `${progress.unit ?? progress.scope} ${progress.done}/${progress.of}${end}`;
}

const percent = (fraction) => `${Math.round(fraction * 100)} %`;
const hours = (value) => `${decimal(value)} h`;

const ratioText = (ratio) => (ratio === null ? "" : `, les derniers jobs en ont pris ×${decimal(Math.round(ratio * 100) / 100)}`);

/** The load in a sentence: what the queue asks of the machine, learned from the archive, at its estimates, against 8:00. */
export function loadText(load) {
  const given = load.givenHours === load.queueHours ? "" : ` (${hours(load.givenHours)} à ses estimations${ratioText(load.estimateRatio)})`;
  const morning = load.pastMorningMin > 0 ? `elle finirait ${durationText(load.pastMorningMin)} après 8 h` : "elle tient avant 8 h";
  return `La file demande ${hours(load.queueHours)} de la machine entière d'après les jobs déjà passés${given} ; ${morning}.`;
}

/** The load in a few words, for a header: the queue's hours, at its estimates, past 8:00. */
export function loadShort(load) {
  const given = load.givenHours === load.queueHours ? "" : ` (${hours(load.givenHours)} annoncées)`;
  return `charge ${hours(load.queueHours)}${given}${load.pastMorningMin > 0 ? ", après 8 h" : ""}`;
}

/** A night in a few words: its date, how busy, how far past the morning. */
export function nightText(night) {
  const day = new Date(night.start).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  const past = night.pastMorningMin > 0 ? `, débordée de ${durationText(night.pastMorningMin)}` : "";
  return `${day} ${percent(night.busy)}${night.underWay ? " (en cours)" : ""}${past}`;
}

/** A planned job's notes: its priority when not normal, its threads, its due time, its prerequisites. */
/** How a learned estimate was learned: "annoncé 6 h 00, appris de 4 passages". */
export function learnedText(job) {
  if (!job.learned) return "";
  const { basis, runs } = job.learned;
  const from = basis === "command" ? `de ${runs} ${plural(runs, "passage")}` : "du rythme du projet";
  return `annoncé ${durationText(job.givenMin)}, appris ${from}`;
}

export function tagsOf(job) {
  return [learnedText(job), job.priority !== 2 ? `priorité ${job.priority}` : "", job.threads > 1 ? `${job.threads} fils` : "", maybe(job.due, "pour "), maybe(job.after.join(", "), "après ")].filter(Boolean).join(", ");
}

/** `mcts-backlog --list`: the machine, then the sections, aligned to `width`. */
export function listText(view, { color = false, width = 120, finished = 8 } = {}) {
  const s = stylesOf(color);
  const shown = view.finished.slice(0, finished);
  const ids = [...view.running, ...view.planned, ...view.blocked, ...view.waiting, ...shown].map((job) => job.id.length);
  const layout = { view, s, id: Math.min(46, Math.max(10, ...ids)), project: 9 };
  const sections = [
    section(layout, "En cours", view.running, runningLine),
    section(layout, "À venir", view.planned, plannedLine),
    view.waiting.length ? section(layout, "En attente", view.waiting, waitingLine) : [],
    section(layout, "Bloqués", view.blocked, blockedLine),
    section(layout, "Derniers finis", shown, finishedLine),
  ];
  const lines = [...headLines(view, s), ...sections.flat()];
  return lines.map((line) => (color ? line : line.slice(0, Math.max(width, 200)))).join("\n");
}

function headLines(view, s) {
  const { doneToday, failedToday, cancelledToday, nightEnd } = view.counts;
  const end = nightEnd ? `${clockText(nightEnd)} (${relativeText(nightEnd, view.now)})` : "";
  const when = new Date(view.now).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  const lines = [`${s.bold("La backlog de la machine")} ${s.gray("— " + when)}`, machineLine(view, s), s.gray(`Aujourd'hui : ${doneToday} ${plural(doneToday, "fini")}, ${failedToday} en échec${maybe(cancelledToday ? cancelledToday + " " + plural(cancelledToday, "annulé") : "", ", ")}${maybe(end, " · la file finirait vers ")}`)];
  if (!view.load) return lines;
  const nights = view.load.nights.map(nightText).join(" · ");
  return [...lines, s.gray(loadText(view.load)), ...(nights ? [s.gray("Nuits : " + nights)] : [])];
}

/** A titled section: a blank line, its title and count, a line a job. */
function section(layout, title, jobs, lineOf) {
  return ["", `${layout.s.bold(title)} ${layout.s.gray("(" + jobs.length + ")")}`, ...jobs.map((job) => lineOf(job, layout))];
}

const named = (job, { project, id }) => `${fit(job.project, project)} ${fit(job.id, id)}`;

function runningLine(job, layout) {
  const { s } = layout;
  return `  ${s.cyan("▶")} ${named(job, layout)} ${progressText(job, s)}${notesText(job, s)}`;
}

function plannedLine(job, layout) {
  const { s, view } = layout;
  const tags = tagsOf(job);
  const when = `${clockText(job.start)} ${s.gray(fit(relativeText(job.start, view.now), 14))}`;
  return `  ${when} ${named(job, layout)} ${fit(durationText(job.estimateMin), 7, "right")}${job.late ? s.red("  en retard sur son échéance") : ""}${tags ? s.gray("  " + tags) : ""}`;
}

const waitingLine = (job, layout) => `  ${layout.s.gray("◷")} ${named(job, layout)} ${layout.s.gray(job.reason)}`;
const blockedLine = (job, layout) => `  ${layout.s.red("■")} ${named(job, layout)} ${layout.s.red(job.reason)}`;

function finishedLine(job, layout) {
  const { s, view } = layout;
  const status = statusOf(job.status);
  const estimate = `estimé ${durationText(job.estimateMin)}`;
  return `  ${s[status.color](status.icon)} ${fit(stampText(job.doneAt, view.now), 11)} ${named(job, layout)} ${fit(durationText(job.minutes), 7, "right")} ${s.gray(estimate)}${job.reason ? s.red("  " + job.reason) : ""}`;
}

import path from "node:path";
import { clip } from "./ansi.js";
import { threadState, when } from "./board-text.js";
import { alarmsOf, clockText, durationText, fit, maybe, noticesOf, notesText, paren, progressNote, progressText, relativeText, stampText, statusOf, tagsOf } from "./backlog-text.js";

/**
 * The terminal view's tabs (node/tui.js): what each lists, its columns, a row's line; the journal's and the traces'
 * words. Pure.
 */
const KIND_WORDS = {
  "runner-started": ["lanceur démarré", "green"],
  "runner-ended": ["lanceur fini", "green"],
  "job-started": ["job lancé", "cyan"],
  "job-ended": ["job fini", "white"],
  "job-requeued": ["remis en file", "yellow"],
  "job-skipped": ["job sauté", "gray"],
  "job-cancelled": ["job arrêté", "yellow"],
  "job-preempting": ["place à un test", "yellow"],
  "job-preempted": ["remis, pour un test", "yellow"],
  "cancel-asked": ["annulation", "yellow"],
  "slot-waiting": ["attend des fils", "gray"],
  "slot-started": ["test lancé", "cyan"],
  "slot-ended": ["test fini", "white"],
  "gap-filled": ["trou rempli", "cyan"],
  "heat-alert": ["garde thermique", "red"],
  "heat-resumed": ["reprise au frais", "green"],
  "memory-stop": ["garde mémoire", "red"],
  "orphans-requeued": ["orphelins repris", "yellow"],
  "queue-retried": ["file réécrite", "gray"],
  "queue-refused": ["file refusée", "red"],
  added: ["ajouté", "blue"],
  crash: ["plantage", "red"],
};
export const kindOf = (kind) => KIND_WORDS[kind] ?? [kind, "white"];
export const localTime = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(",", "") : "?");

const JOURNAL_TEXT = {
  "job-ended": (entry) => `${entry.id} : ${statusOf(entry.status).word}, ${durationText(entry.minutes)}${paren(entry.reason)}`,
  "job-started": (entry) => `${entry.id} (${entry.threads} fil${entry.threads > 1 ? "s" : ""}, pid ${entry.childPid ?? "?"})`,
  "runner-started": (entry) => `${entry.budget} fils au plus${entry.cpu ? ", CPU " + entry.cpu.celsius + " °C" : ""}`,
  "slot-waiting": (entry) => `${entry.id} : ${entry.threads} fil(s), ${entry.slots?.length ?? 0} job(s) tournent`,
  "slot-started": (entry) => `${entry.id} : ${entry.threads} fil(s), après ${durationText(entry.waitedMin)} d'attente`,
  "slot-ended": (entry) => `${entry.id} : code ${entry.code}, ${durationText(entry.minutes)}`,
  "gap-filled": (entry) => `${entry.id} (${entry.threads} fil(s)) pendant que ${entry.waiting} attend ${entry.waitingThreads} fils`,
  "heat-alert": (entry) => `${entry.celsius} °C, ${entry.stopping?.length ?? 0} job(s) arrêtés`,
  "memory-stop": (entry) => `${entry.id} : ${entry.freeGb} Go libres`,
  crash: (entry) => entry.message,
};

/** A journal entry in a few words. */
export const journalText = (entry) => JOURNAL_TEXT[entry.kind]?.(entry) ?? entry.ids?.join(", ") ?? entry.id ?? entry.message ?? "";

/** How a trace file of a process still there stands: started (no library call yet), silent, beating. */
function liveState(trace, s) {
  if (!Object.keys(trace.counters ?? {}).length) return s.gray("○ lancé");
  if (trace.quietMin !== null && trace.quietMin >= 2) return s.yellow(`◌ muet ${durationText(trace.quietMin)}`);
  return s.green("● bat");
}

/** How a trace file stands: beating, ended, crashed, silent. */
export function traceState(trace, s) {
  if (trace.ended?.kind === "crash") return s.red("✖ planté");
  if (trace.stopped) return s.yellow(`■ ${statusOf(trace.stopped.status).word}`);
  if (trace.ended) return trace.ended.code === 0 ? s.green("✔ fini") : s.yellow(`■ fini (${trace.ended.code})`);
  return liveState(trace, s);
}

const counterText = ([scope, one]) => `${scope} ${one.calls ?? 0}${maybe(one.errors, " ✖")}${maybe(one.slow, " ⧗")}`;
const countersText = (counters = {}) => Object.entries(counters).map(counterText).join("  ");

/** Column titles fitted to their widths. */
const headOf = (titles, widths) => titles.map((one, i) => fit(one, widths[i])).join(" ");

function runningRow(job, w, s) {
  const note = notesText(job, s).trim() || s.gray(job.lastLine);
  return `${s.cyan("▶")}  ${fit(job.project, 10)} ${fit(job.id, w.id)} ${fit(job.threads, 5)} ${clip(progressText(job, s), 24)} ${note}`;
}

function plannedRow(job, w, s, now) {
  const late = job.late ? s.red("en retard sur son échéance ") : "";
  return `${fit(clockText(job.start), 6)} ${s.gray(fit(relativeText(job.start, now), 14))} ${fit(job.project, 10)} ${fit(job.id, w.id)} ${fit(durationText(job.estimateMin), 8)} ${late}${s.gray(tagsOf(job))}`;
}

function finishedRow(job, w, s, now) {
  const status = statusOf(job.status);
  return `${s[status.color](status.icon)}  ${fit(stampText(job.doneAt, now), 12)} ${fit(job.project, 10)} ${fit(job.id, w.id)} ${fit(durationText(job.minutes), 8)} ${s.gray(fit(durationText(job.estimateMin), 9))} ${job.reason ? s.red(job.reason) : ""}`;
}

function traceRow(trace, w, s) {
  const alarms = alarmsOf({ incidents: trace.incidents }).join(", ");
  const notices = [progressNote(trace.reported), ...noticesOf(trace.incidents)].filter(Boolean).join(", ");
  const incidents = (alarms ? s.red(alarms + "  ") : "") + (notices ? s.yellow(notices + "  ") : "");
  return `${clip(traceState(trace, s), 14)} ${fit(trace.id ?? trace.name, w.id + 18)} ${incidents}${s.gray(countersText(trace.counters))}`;
}

/** A thread of the board: its last message's time and ends, its subject, its state (closed, waiting on whom, read). */
function boardRow(thread, w, s) {
  let color = "green";
  if (thread.done) color = "gray";
  else if (thread.waiting.length > 0) color = "yellow";
  const ends = thread.last.from + " → " + thread.last.to.join(", ");
  return `${s.gray(fit(when(thread.last.at), 12))} ${fit(ends, 24)} ${fit(thread.subject, w.id + 10)} ${s[color](threadState(thread))}`;
}

/** A short test's state: waiting, running, ended well or not, or a job of the queue freed for one. */
const TEST_STATES = { waiting: ["◷", "gray"], running: ["▶", "cyan"], done: ["✔", "green"], failed: ["✖", "red"], preempted: ["⇄", "yellow"] };

/** How long: waited so far, running so far, or taken, with when it ended. */
function testTime(test, now) {
  if (test.state === "waiting") return `attend ${durationText(test.sinceMin)}${test.series ? ", en série" : ""}`;
  if (test.state === "running") return `depuis ${durationText(test.sinceMin)}`;
  if (test.state === "preempted") return stampText(test.stamp, now);
  return `${durationText(test.minutes)}, ${stampText(test.stamp, now)}`;
}

function testRow(test, w, s, now) {
  const [icon, color] = TEST_STATES[test.state];
  const what = test.state === "preempted" ? s.yellow("job de la file : a laissé sa place à un test") : s.gray(test.command);
  const code = test.code === undefined || test.code === 0 ? fit("", 8) : s.red(fit(`code ${test.code}`, 8));
  return `${s[color](icon)}  ${fit(test.project, 10)} ${fit(test.id, w.id)} ${fit(test.threads, 5)} ${fit(testTime(test, now), 22)} ${code} ${what}`;
}

/** The tabs: what each lists, its columns, a row's line, and what an empty one says. */
export const TABS = [
  { title: "En cours", rows: (view) => view.running, head: (w) => headOf(["", "projet", "job", "fils", "avancement", "à surveiller"], [2, 10, w.id, 5, 24, 40]), line: runningRow },
  { title: "À venir", rows: (view) => view.planned, head: (w) => headOf(["début", "", "projet", "job", "durée", "notes"], [6, 14, 10, w.id, 8, 30]), line: plannedRow },
  {
    title: "Bloqués",
    rows: (view) => [...view.blocked, ...view.waiting],
    head: (w) => headOf(["", "projet", "job", "pourquoi"], [2, 10, w.id, 40]),
    line: (job, w, s) => `${job.blocked ? s.red("■") : s.gray("◷")}  ${fit(job.project, 10)} ${fit(job.id, w.id)} ${job.blocked ? s.red(job.reason) : s.gray(job.reason)}`,
  },
  { title: "Finis", rows: (view) => view.finished, head: (w) => headOf(["", "fin", "projet", "job", "durée", "estimé", ""], [2, 12, 10, w.id, 8, 9, 20]), line: finishedRow },
  {
    title: "Journal",
    rows: (view) => view.journal,
    empty: "Aucun journal : le lanceur qui tourne date d'avant le 26/10 ; il en écrira un à son prochain démarrage.",
    head: () => headOf(["quand", "quoi", "détail"], [15, 18, 40]),
    line: (entry, w, s) => {
      const [word, color] = kindOf(entry.kind);
      return `${s.gray(fit(localTime(entry.at), 15))} ${s[color](fit(word, 18))} ${journalText(entry)}`;
    },
  },
  {
    title: "Traces",
    rows: (view) => view.traces,
    empty: "Aucune trace : les jobs d'un lanceur d'après le 26/10 en écrivent une, et MCTS_TRACE=1 à la main dans logs/ du projet.",
    head: (w) => headOf(["état", "trace", "appels de la bibliothèque"], [14, w.id + 18, 40]),
    line: traceRow,
  },
  {
    title: "Messages",
    rows: (view) => view.board?.threads ?? [],
    empty: "Aucun message : les sessions postent par npx mcts-board --post (docs/board.md).",
    head: (w) => headOf(["dernier", "de → à", "sujet", "état"], [12, 24, w.id + 10, 30]),
    line: boardRow,
  },
  {
    title: "Tests",
    rows: (view) => view.slots ?? [],
    empty: "Aucun test court : npx mcts-backlog --slot N -- commande (servi avant les jobs suivants de la file).",
    head: (w) => headOf(["", "projet", "test", "fils", "durée", "", "commande"], [2, 10, w.id, 5, 22, 8, 30]),
    line: testRow,
  },
];

const textOf = (row) => [row.id, row.project, row.command, row.reason, row.kind, row.name, row.message, row.subject].filter(Boolean).join(" ").toLowerCase();
/** The rows of tab `index`, the filter applied. */
export const rowsOf = (view, index, filter = "") => TABS[index].rows(view).filter((row) => !filter || textOf(row).includes(filter.toLowerCase()));

/** By tab, the file whose end the panel shows: a job's output, a trace, a thread's last message. */
const FILES = {
  0: (row) => row.output,
  3: (row, home) => (row.output ? path.join(home, row.output) : null),
  5: (row) => row.file,
  6: (row) => row.last?.file,
};

/** The file whose end the panel shows for `row` in tab `index`, or null. */
export const fileOf = (index, row, home) => (row && FILES[index] ? (FILES[index](row, home) ?? null) : null);

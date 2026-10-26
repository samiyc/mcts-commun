import path from "node:path";
import { clip } from "./ansi.js";
import { clockText, durationText, fit, maybe, paren, progressText, relativeText, stampText, statusOf, tagsOf, warningsOf } from "./backlog-text.js";

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
  "cancel-asked": ["annulation", "yellow"],
  "slot-waiting": ["attend des fils", "gray"],
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
  "heat-alert": (entry) => `${entry.celsius} °C, ${entry.stopping?.length ?? 0} job(s) arrêtés`,
  "memory-stop": (entry) => `${entry.id} : ${entry.freeGb} Go libres`,
  crash: (entry) => entry.message,
};

/** A journal entry in a few words. */
export const journalText = (entry) => JOURNAL_TEXT[entry.kind]?.(entry) ?? entry.ids?.join(", ") ?? entry.id ?? entry.message ?? "";

/** How a trace file stands: beating, ended, crashed, silent. */
export function traceState(trace, s) {
  if (trace.ended?.kind === "crash") return s.red("✖ planté");
  if (trace.ended) return trace.ended.code === 0 ? s.green("✔ fini") : s.yellow(`■ fini (${trace.ended.code})`);
  if (trace.quietMin !== null && trace.quietMin >= 2) return s.yellow(`◌ muet ${durationText(trace.quietMin)}`);
  return s.green("● bat");
}

const counterText = ([scope, one]) => `${scope} ${one.calls ?? 0}${maybe(one.errors, " ✖")}${maybe(one.slow, " ⧗")}`;
const countersText = (counters = {}) => Object.entries(counters).map(counterText).join("  ");

/** Column titles fitted to their widths. */
const headOf = (titles, widths) => titles.map((one, i) => fit(one, widths[i])).join(" ");

function runningRow(job, w, s) {
  const warnings = warningsOf(job);
  const note = warnings.length ? s.yellow(warnings.join(", ")) : s.gray(job.lastLine);
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
  const incidents = trace.problems.length ? s.red(trace.problems.length + " incident(s)  ") : "";
  return `${clip(traceState(trace, s), 14)} ${fit(trace.id ?? trace.name, w.id + 18)} ${incidents}${s.gray(countersText(trace.counters))}`;
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
];

const textOf = (row) => [row.id, row.project, row.command, row.reason, row.kind, row.name, row.message].filter(Boolean).join(" ").toLowerCase();
/** The rows of tab `index`, the filter applied. */
export const rowsOf = (view, index, filter = "") => TABS[index].rows(view).filter((row) => !filter || textOf(row).includes(filter.toLowerCase()));

/** The file whose end the panel shows for `row`: a job's output, a trace. */
export function fileOf(index, row, home) {
  if (!row) return null;
  if (index === 0) return row.output;
  if (index === 3 && row.output) return path.join(home, row.output);
  if (index === 5) return row.file;
  return null;
}

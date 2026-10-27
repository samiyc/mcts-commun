// The backlog page's journal and traces (web/backlog.js).
import { alarmsOf, durationText, noticesOf, paren, progressNote, relativeText, statusOf } from "../node/backlog-text.js";
import { $, badge, escape, table } from "./backlog-html.js";

const KINDS = {
  "runner-started": ["lanceur démarré", "ok"],
  "runner-ended": ["lanceur fini", "ok"],
  "job-started": ["job lancé", ""],
  "job-ended": ["job fini", ""],
  "job-requeued": ["remis en file", "warn"],
  "job-skipped": ["job sauté", ""],
  "job-cancelled": ["job arrêté", "warn"],
  "cancel-asked": ["annulation", "warn"],
  "slot-waiting": ["attend des fils", ""],
  "heat-alert": ["garde thermique", "bad"],
  "heat-resumed": ["reprise au frais", "ok"],
  "memory-stop": ["garde mémoire", "bad"],
  "orphans-requeued": ["orphelins repris", "warn"],
  "queue-retried": ["file réécrite", ""],
  "queue-refused": ["file refusée", "bad"],
  added: ["ajouté", ""],
  crash: ["plantage", "bad"],
};

const WHAT = {
  "job-ended": (entry) => `${entry.id} : ${statusOf(entry.status).word}, ${durationText(entry.minutes)}${paren(entry.reason)}`,
  "job-started": (entry) => `${entry.id} (${entry.threads} fil${entry.threads > 1 ? "s" : ""})`,
  "runner-started": (entry) => `${entry.budget} fils au plus`,
  "heat-alert": (entry) => `${entry.celsius} °C`,
};
const whatOf = (entry) => WHAT[entry.kind]?.(entry) ?? entry.message ?? entry.id ?? entry.ids?.join(", ") ?? "";

function entryHtml(entry) {
  const [word, level] = KINDS[entry.kind] ?? [entry.kind, ""];
  return `<li><time title="${escape(entry.at)}">${new Date(entry.at).toLocaleTimeString("fr-FR")}</time><span class="kind ${level}">${escape(word)}</span><span class="what">${escape(whatOf(entry))}</span></li>`;
}

export function journal(view) {
  $("journal-count").textContent = `(${view.journal.length})`;
  if (!view.journal.length) {
    $("journal").innerHTML = '<p class="hint">Aucun journal : le lanceur qui tourne date d\'avant le 26/10, il en écrira un (<code>~/.mcts-backlog/journal/</code>) à son prochain démarrage.</p>';
    return;
  }
  $("journal").innerHTML = `<ul class="journal">${view.journal.slice(0, 200).map(entryHtml).join("")}</ul>`;
}

/** How a trace stands, as a badge: crashed, ended, silent, beating. */
function traceBadge(trace) {
  if (trace.ended?.kind === "crash") return badge("planté", "bad");
  if (trace.ended?.code === 0) return badge("fini", "ok");
  if (trace.ended) return badge(`fini (${trace.ended.code})`);
  return liveBadge(trace);
}

/** A trace still written: started (no library call yet), silent, beating. */
function liveBadge(trace) {
  if (!Object.keys(trace.counters ?? {}).length) return badge("lancée");
  return trace.quietMin >= 2 ? badge(`muette ${durationText(trace.quietMin)}`) : badge("bat", "ok");
}

const scopeText = ([scope, one]) => scope + " " + one.calls + (one.errors ? ` · ${one.errors} err.` : "") + (one.slow ? ` · ${one.slow} lents` : "");

function traceRow(trace, view) {
  const name = escape(trace.id ?? trace.name);
  const counters = Object.entries(trace.counters ?? {}).map(scopeText).join(" — ");
  const beat = trace.lastBeat ? relativeText(Date.parse(trace.lastBeat.at), view.now) : "—";
  const progress = progressNote(trace.reported);
  const incidents = [...alarmsOf({ incidents: trace.incidents }).map((one) => badge(one, "bad")), ...(progress ? [badge(progress, "ok")] : []), ...noticesOf(trace.incidents).map((one) => badge(one))].join("");
  return `<tr class="click" data-id="${name}" data-kind="trace" title="Voir la fin de la trace"><td>${traceBadge(trace)}</td><td class="job">${name}</td><td>${beat}</td><td class="wrap">${escape(counters)}</td><td>${incidents}</td></tr>`;
}

export function traces(view) {
  $("traces-count").textContent = `(${view.traces.length})`;
  const rows = view.traces.map((trace) => traceRow(trace, view));
  $("traces").innerHTML = table(["État", "Trace", "Battement", "Appels de la bibliothèque", ""], rows, "Aucune trace pour l'instant : les jobs d'un lanceur d'après le 26/10 en écrivent une, et MCTS_TRACE=1 à la main dans logs/ du projet.");
}

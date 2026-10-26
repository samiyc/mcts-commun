// The backlog's page (Sami, 26/10/2026: the backlog was a black box): GET /api/backlog every 2 s (bin/serve.js), drawn.
// The words are the terminal's (node/backlog-text.js imports nothing: the page loads it as is).
import { clockText, durationText, relativeText, stampText, statusOf, warningsOf } from "../node/backlog-text.js";

const REFRESH_MS = 2_000;
const NIGHT_LANES = 70;
const $ = (id) => document.getElementById(id);
const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const decimal = (value) => String(value).replace(".", ",");
const PROJECTS = new Set(["cuisine", "entrepot", "urgences", "lopin"]);
const project = (name) => `<span class="project" style="--project: var(--${PROJECTS.has(name) ? name : "other"})">${escape(name)}</span>`;
const gauge = (fraction, level = "") => `<div class="gauge ${level}"><span style="width: ${Math.max(0, Math.min(100, fraction * 100)).toFixed(1)}%"></span></div>`;
const badge = (text, level = "") => `<span class="badge ${level}">${escape(text)}</span>`;
const table = (head, rows, empty) => (rows.length ? `<thead><tr>${head.map((one) => `<th${one.startsWith(">") ? ' class="num"' : ""}>${escape(one.replace(/^>/, ""))}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody>` : `<tbody><tr><td class="hint">${escape(empty)}</td></tr></tbody>`);

function machine(view) {
  const runner = view.runners.find((one) => one.alive) ?? view.runners[0];
  const { used, budget } = view.threads;
  const cpu = view.machine?.cpu;
  const ram = view.machine;
  const { doneToday, failedToday, nightEnd } = view.counts;
  const tiles = [
    ["Lanceur", runner ? `<span class="dot ${runner.alive ? "on" : "off"}"></span>${runner.alive ? "en marche" : "arrêté"}` : '<span class="dot off"></span>aucun', runner ? `${escape(runner.runner)} pid ${runner.pid}${runner.since ? ` · depuis ${durationText((view.now - Date.parse(runner.since)) / 60_000)}` : ""}` : "npx mcts-backlog pour jouer la file"],
    ["Fils", `${used}<small> / ${budget}</small>`, gauge(used / budget, used > budget ? "bad" : "")],
    ["CPU", cpu ? `${decimal(cpu.celsius)}<small> °C</small>` : "?", cpu ? gauge(cpu.celsius / 100, cpu.celsius >= 85 ? "bad" : cpu.celsius >= 75 ? "warn" : "") : "LibreHardwareMonitor ne répond pas"],
    ["Mémoire libre", ram ? `${decimal(ram.freeGb)}<small> / ${decimal(ram.totalGb)} Go</small>` : "?", ram ? gauge(1 - ram.freeGb / ram.totalGb, ram.freeGb < 5 ? "bad" : ram.freeGb < 8 ? "warn" : "") : ""],
    ["Aujourd'hui", `${doneToday}<small> fini${doneToday > 1 ? "s" : ""}</small>`, failedToday ? `<span class="status-failed">${failedToday} en échec</span>` : "aucun échec"],
    ["Fin de la file", nightEnd ? clockText(nightEnd) : "—", nightEnd ? relativeText(nightEnd, view.now) : "rien à venir"],
  ];
  $("machine").innerHTML = tiles.map(([label, value, sub]) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`).join("");
}

function alerts(view) {
  const bad = [];
  const warn = [];
  for (const runner of view.runners.filter((one) => !one.alive)) bad.push(`Le lanceur ${runner.pid} est mort : ses jobs « en cours » reprendront au prochain lancement.`);
  for (const job of view.running) for (const warning of warningsOf(job)) (warning === "lanceur mort" ? bad : warn).push(`${job.id} : ${warning}`);
  for (const job of view.blocked) bad.push(`${job.id} est bloqué : ${job.reason}`);
  for (const trace of view.traces.filter((one) => one.ended?.kind === "crash")) bad.push(`${trace.id ?? trace.name} a planté : ${trace.ended.message ?? ""}`);
  for (const entry of view.journal.filter((one) => one.kind === "crash" && view.now - Date.parse(one.at) < 86_400_000)) bad.push(`Le lanceur a planté à ${clockText(Date.parse(entry.at))} : ${entry.message}`);
  const block = (items, level) => (items.length ? `<div class="alert ${level}"><strong>${level === "bad" ? "À regarder" : "À surveiller"}</strong><ul>${items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul></div>` : "");
  $("alerts").innerHTML = block(bad, "bad") + block(warn, "");
}

function running(view) {
  $("running-count").textContent = `(${view.running.length})`;
  const rows = view.running.map((job) => {
    const near = job.elapsedMin > job.limitMin * 0.9;
    const warnings = warningsOf(job).map((one) => badge(one, one === "lanceur mort" ? "bad" : ""));
    return `<tr class="click" data-id="${escape(job.id)}" data-kind="output" title="Voir la fin de sa sortie">
      <td>${project(job.project)}</td><td class="job">${escape(job.id)}</td><td class="num">${job.threads}</td>
      <td class="progress">${Math.round(job.elapsedMin)} / ${Math.round(job.estimateMin)} min${gauge(job.progress, near ? "bad" : job.over ? "warn" : "")}</td>
      <td>${stampText(job.startedAt, view.now)}</td>
      <td><div class="badges">${warnings.join("") || badge(job.beatMin !== null ? "trace vivante" : "sans trace", job.beatMin !== null ? "ok" : "quiet")}</div></td>
      <td class="last">${escape(job.lastLine)}</td></tr>`;
  });
  $("running").innerHTML = table(["Projet", "Job", ">Fils", "Écoulé / estimé", "Depuis", "État", "Dernière ligne"], rows, "Rien ne tourne.");
}

/** The night: the running jobs from their start, the planned ones after, on one time axis. */
function night(view) {
  const lanes = [
    ...view.running.map((job) => ({ id: job.id, project: job.project, start: view.now - job.elapsedMin * 60_000, end: Math.max(view.now + 60_000, view.now + (job.estimateMin - job.elapsedMin) * 60_000), planned: false })),
    ...view.planned.map((job) => ({ ...job, planned: true })),
  ];
  $("night-count").textContent = view.planned.length ? `(${view.planned.length} à venir, fin vers ${clockText(view.counts.nightEnd)})` : "";
  if (!lanes.length) {
    $("night").innerHTML = '<p class="hint">Rien ne tourne, rien n\'est prévu.</p>';
    return;
  }
  const shown = lanes.slice(0, NIGHT_LANES);
  const from = Math.min(view.now, ...shown.map((lane) => lane.start));
  const to = Math.max(view.now + 30 * 60_000, ...shown.map((lane) => lane.end));
  const x = (ms) => `${(((ms - from) / (to - from)) * 100).toFixed(2)}%`;
  const hours = [];
  for (let tick = Math.ceil(from / 3_600_000) * 3_600_000; tick <= to; tick += (to - from > 12 * 3_600_000 ? 2 : 1) * 3_600_000) hours.push(tick);
  const lane = (one) => {
    const late = one.late ? " late" : "";
    const title = `${one.id} · ${clockText(one.start)} → ${clockText(one.end)}${one.planned ? " (prévu)" : " (en cours)"}${one.late ? " · en retard sur son échéance" : ""}`;
    const due = one.due ? `<span class="due" style="left: ${x(Date.parse(one.due))}" title="échéance ${escape(one.due)}"></span>` : "";
    return `<div class="lane"><div class="name" title="${escape(one.id)}">${escape(one.id)}</div><div class="track"><span class="bar${one.planned ? " planned" : ""}${late}" style="--project: var(--${PROJECTS.has(one.project) ? one.project : "other"}); left: ${x(one.start)}; width: calc(${x(one.end)} - ${x(one.start)})" title="${escape(title)}"></span>${due}</div></div>`;
  };
  const projects = [...new Set(shown.map((one) => one.project))];
  $("night").innerHTML = `<div class="axis">${hours.map((tick) => `<span class="tick" style="left: ${x(tick)}">${clockText(tick)}</span>`).join("")}<span class="now" style="left: ${x(view.now)}" title="maintenant"></span></div>
    ${shown.map(lane).join("")}
    ${lanes.length > shown.length ? `<p class="more">… et ${lanes.length - shown.length} autres.</p>` : ""}
    <p class="legend">${projects.map(project).join("")}<span>plein : en cours · hachuré : prévu</span></p>`;
}

function held(view) {
  const all = [...view.blocked, ...view.waiting];
  $("held-count").textContent = `(${all.length})`;
  if (view.blocked.length) $("held-card").open = true;
  const rows = all.map((job) => `<tr><td>${badge(job.blocked ? "bloqué" : "attend", job.blocked ? "bad" : "quiet")}</td><td>${project(job.project)}</td><td class="job">${escape(job.id)}</td><td class="wrap">${escape(job.reason)}</td><td class="wrap">${escape(job.command)}</td></tr>`);
  $("held").innerHTML = table(["", "Projet", "Job", "Pourquoi", "Commande"], rows, "Rien de bloqué.");
}

function finished(view) {
  $("finished-count").textContent = `(${view.counts.doneToday + view.counts.failedToday} aujourd'hui)`;
  const rows = view.finished.map((job) => {
    const status = statusOf(job.status);
    const ratio = job.estimateMin > 0 ? job.minutes / job.estimateMin : 0;
    return `<tr class="click" data-id="${escape(job.id)}" data-kind="output" title="Voir la fin de sa sortie">
      <td>${stampText(job.doneAt, view.now)}</td><td class="status-${escape(job.status)}">${status.icon} ${escape(status.word)}</td><td>${project(job.project)}</td><td class="job">${escape(job.id)}</td>
      <td><div class="compare">${durationText(job.minutes)} <span class="hint">sur ${durationText(job.estimateMin)} estimées</span>${gauge(Math.min(ratio, 1), ratio > 1 ? "warn" : "")}</div></td>
      <td class="wrap">${job.reason ? `<span class="status-failed">${escape(job.reason)}</span>` : ""}</td></tr>`;
  });
  $("finished").innerHTML = table(["Fin", "Statut", "Projet", "Job", "Durée", ""], rows, "Rien de fini pour l'instant.");
}

const KINDS = { "runner-started": ["lanceur démarré", "ok"], "runner-ended": ["lanceur fini", "ok"], "job-started": ["job lancé", ""], "job-ended": ["job fini", ""], "job-requeued": ["remis en file", "warn"], "slot-waiting": ["attend des fils", ""], "heat-alert": ["garde thermique", "bad"], "heat-resumed": ["reprise au frais", "ok"], "memory-stop": ["garde mémoire", "bad"], "orphans-requeued": ["orphelins repris", "warn"], "queue-retried": ["file réécrite", ""], "queue-refused": ["file refusée", "bad"], added: ["ajouté", ""], crash: ["plantage", "bad"] };
function journal(view) {
  $("journal-count").textContent = `(${view.journal.length})`;
  if (!view.journal.length) {
    $("journal").innerHTML = '<p class="hint">Aucun journal : le lanceur qui tourne date d\'avant le 26/10, il en écrira un (<code>~/.mcts-backlog/journal/</code>) à son prochain démarrage.</p>';
    return;
  }
  const what = (entry) => {
    if (entry.kind === "job-ended") return `${entry.id} : ${statusOf(entry.status).word}, ${durationText(entry.minutes)}${entry.reason ? ` (${entry.reason})` : ""}`;
    if (entry.kind === "job-started") return `${entry.id} (${entry.threads} fil${entry.threads > 1 ? "s" : ""})`;
    if (entry.kind === "runner-started") return `${entry.budget} fils au plus`;
    if (entry.kind === "heat-alert") return `${entry.celsius} °C`;
    return entry.message ?? entry.id ?? entry.ids?.join(", ") ?? "";
  };
  $("journal").innerHTML = `<ul class="journal">${view.journal
    .slice(0, 200)
    .map((entry) => {
      const [word, level] = KINDS[entry.kind] ?? [entry.kind, ""];
      return `<li><time title="${escape(entry.at)}">${new Date(entry.at).toLocaleTimeString("fr-FR")}</time><span class="kind ${level}">${escape(word)}</span><span class="what">${escape(what(entry))}</span></li>`;
    })
    .join("")}</ul>`;
}

function traces(view) {
  $("traces-count").textContent = `(${view.traces.length})`;
  const rows = view.traces.map((trace) => {
    const state = trace.ended?.kind === "crash" ? badge("planté", "bad") : trace.ended ? badge(trace.ended.code === 0 ? "fini" : `fini (${trace.ended.code})`, trace.ended.code === 0 ? "ok" : "") : trace.quietMin >= 2 ? badge(`muette ${durationText(trace.quietMin)}`) : badge("bat", "ok");
    const counters = Object.entries(trace.counters ?? {})
      .map(([scope, one]) => `${scope} ${one.calls}${one.errors ? ` · ${one.errors} err.` : ""}${one.slow ? ` · ${one.slow} lents` : ""}`)
      .join(" — ");
    return `<tr class="click" data-id="${escape(trace.id ?? trace.name)}" data-kind="trace" title="Voir la fin de la trace"><td>${state}</td><td class="job">${escape(trace.id ?? trace.name)}</td><td>${trace.lastBeat ? relativeText(Date.parse(trace.lastBeat.at), view.now) : "—"}</td><td class="wrap">${escape(counters)}</td><td>${trace.problems.length ? badge(`${trace.problems.length} incident(s)`, "bad") : ""}</td></tr>`;
  });
  $("traces").innerHTML = table(["État", "Trace", "Battement", "Appels de la bibliothèque", ""], rows, "Aucune trace pour l'instant : les jobs d'un lanceur d'après le 26/10 en écrivent une, et MCTS_TRACE=1 à la main dans logs/ du projet.");
}

// The end of an output or a trace, followed while the dialog is open.
let following = null;
async function showTail() {
  if (!following) return;
  const response = await fetch(`/api/backlog/tail?id=${encodeURIComponent(following.id)}&kind=${following.kind}`);
  const body = await response.json();
  const pre = $("tail-lines");
  const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
  $("tail-file").textContent = body.file ?? body.error ?? "";
  pre.textContent = body.lines?.join("\n") || "(vide pour l'instant)";
  if (atEnd) pre.scrollTop = pre.scrollHeight;
}
document.addEventListener("click", (event) => {
  const row = event.target.closest("tr.click");
  if (!row) return;
  following = { id: row.dataset.id, kind: row.dataset.kind };
  $("tail-title").textContent = row.dataset.id;
  $("tail-lines").textContent = "…";
  $("tail").showModal();
  showTail().then(() => ($("tail-lines").scrollTop = $("tail-lines").scrollHeight));
});
$("tail-close").addEventListener("click", () => $("tail").close());
$("tail").addEventListener("close", () => (following = null));

async function refresh() {
  if (document.hidden) return;
  try {
    const response = await fetch("/api/backlog", { cache: "no-store" });
    const view = await response.json();
    if (!response.ok) throw new Error(view.error ?? response.statusText);
    for (const draw of [machine, alerts, running, night, held, finished, journal, traces]) draw(view);
    await showTail();
    $("pulse").className = "pulse beat";
    $("pulse").textContent = `en direct · ${new Date(view.now).toLocaleTimeString("fr-FR")}`;
    setTimeout(() => $("pulse").classList.remove("beat"), 700);
  } catch (error) {
    $("pulse").className = "pulse stale";
    $("pulse").textContent = `serveur injoignable (${error.message})`;
  }
}
refresh();
setInterval(refresh, REFRESH_MS);
document.addEventListener("visibilitychange", refresh);

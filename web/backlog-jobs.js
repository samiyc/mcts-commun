// The backlog page's job tables (web/backlog.js): running, blocked or waiting, ended.
import { alarmsOf, durationText, progressNote, stampText, statusOf, warningsOf } from "../node/backlog-text.js";
import { $, badge, escape, gauge, project, table } from "./backlog-html.js";

/** A running job's gauge: red near its limit, orange past its estimate. */
function progressLevel(job) {
  if (job.elapsedMin > job.limitMin * 0.9) return "bad";
  return job.over ? "warn" : "";
}

/** Its alarms, progress and warnings as badges, or whether its trace beats. */
function stateBadges(job) {
  const progress = progressNote(job.reported);
  const badges = [...alarmsOf(job).map((one) => badge(one, "bad")), ...(progress ? [badge(progress, "ok")] : []), ...warningsOf(job).map((one) => badge(one))];
  if (badges.length) return badges.join("");
  return job.beatMin === null ? badge("sans trace", "quiet") : badge("trace vivante", "ok");
}

function runningRow(job, view) {
  return `<tr class="click" data-id="${escape(job.id)}" data-kind="output" title="Voir la fin de sa sortie">
      <td>${project(job.project)}</td><td class="job">${escape(job.id)}</td><td class="num">${job.threads}</td>
      <td class="progress">${Math.round(job.elapsedMin)} / ${Math.round(job.estimateMin)} min${gauge(job.progress, progressLevel(job))}</td>
      <td>${stampText(job.startedAt, view.now)}</td>
      <td><div class="badges">${stateBadges(job)}</div></td>
      <td class="last">${escape(job.lastLine)}</td></tr>`;
}

export function running(view) {
  $("running-count").textContent = `(${view.running.length})`;
  const rows = view.running.map((job) => runningRow(job, view));
  $("running").innerHTML = table(["Projet", "Job", ">Fils", "Écoulé / estimé", "Depuis", "État", "Dernière ligne"], rows, "Rien ne tourne.");
}

export function held(view) {
  const all = [...view.blocked, ...view.waiting];
  $("held-count").textContent = `(${all.length})`;
  if (view.blocked.length) /** @type {HTMLDetailsElement} */ ($("held-card")).open = true;
  const state = (job) => (job.blocked ? badge("bloqué", "bad") : badge("attend", "quiet"));
  const rows = all.map((job) => `<tr><td>${state(job)}</td><td>${project(job.project)}</td><td class="job">${escape(job.id)}</td><td class="wrap">${escape(job.reason)}</td><td class="wrap">${escape(job.command)}</td></tr>`);
  $("held").innerHTML = table(["", "Projet", "Job", "Pourquoi", "Commande"], rows, "Rien de bloqué.");
}

function finishedRow(job, view) {
  const status = statusOf(job.status);
  const ratio = job.estimateMin > 0 ? job.minutes / job.estimateMin : 0;
  const reason = job.reason ? `<span class="status-failed">${escape(job.reason)}</span>` : "";
  return `<tr class="click" data-id="${escape(job.id)}" data-kind="output" title="Voir la fin de sa sortie">
      <td>${stampText(job.doneAt, view.now)}</td><td class="status-${escape(job.status)}">${status.icon} ${escape(status.word)}</td><td>${project(job.project)}</td><td class="job">${escape(job.id)}</td>
      <td><div class="compare">${durationText(job.minutes)} <span class="hint">sur ${durationText(job.estimateMin)} estimées</span>${gauge(Math.min(ratio, 1), ratio > 1 ? "warn" : "")}</div></td>
      <td class="wrap">${reason}</td></tr>`;
}

export function finished(view) {
  $("finished-count").textContent = `(${view.counts.endedToday} aujourd'hui)`;
  const rows = view.finished.map((job) => finishedRow(job, view));
  $("finished").innerHTML = table(["Fin", "Statut", "Projet", "Job", "Durée", ""], rows, "Rien de fini pour l'instant.");
}

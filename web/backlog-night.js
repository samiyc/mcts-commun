// The backlog page's night (web/backlog.js): the running jobs from their start, the planned ones after, on one axis.
import { clockText } from "../node/backlog-text.js";
import { $, escape, project, projectColor } from "./backlog-html.js";

const NIGHT_LANES = 70;
const HOUR = 3_600_000;

/** The lanes: a running job from its start to its estimate (a minute from now at the soonest), then the planned. */
function lanesOf(view) {
  const running = view.running.map((job) => ({ id: job.id, project: job.project, start: view.now - job.elapsedMin * 60_000, end: Math.max(view.now + 60_000, view.now + (job.estimateMin - job.elapsedMin) * 60_000), planned: false }));
  return [...running, ...view.planned.map((job) => ({ ...job, planned: true }))];
}

/** The hours marked on the axis, every other one past twelve hours. */
function hoursOf(from, to) {
  const step = (to - from > 12 * HOUR ? 2 : 1) * HOUR;
  const hours = [];
  for (let tick = Math.ceil(from / HOUR) * HOUR; tick <= to; tick += step) hours.push(tick);
  return hours;
}

function laneHtml(one, x) {
  const late = one.late ? " late" : "";
  const kind = one.planned ? " planned" : "";
  const title = `${one.id} · ${clockText(one.start)} → ${clockText(one.end)}${one.planned ? " (prévu)" : " (en cours)"}${one.late ? " · en retard sur son échéance" : ""}`;
  const due = one.due ? `<span class="due" style="left: ${x(Date.parse(one.due))}" title="échéance ${escape(one.due)}"></span>` : "";
  const bar = `<span class="bar${kind}${late}" style="--project: ${projectColor(one.project)}; left: ${x(one.start)}; width: calc(${x(one.end)} - ${x(one.start)})" title="${escape(title)}"></span>`;
  return `<div class="lane"><div class="name" title="${escape(one.id)}">${escape(one.id)}</div><div class="track">${bar}${due}</div></div>`;
}

export function night(view) {
  const lanes = lanesOf(view);
  $("night-count").textContent = view.planned.length ? `(${view.planned.length} à venir, fin vers ${clockText(view.counts.nightEnd)})` : "";
  if (!lanes.length) {
    $("night").innerHTML = '<p class="hint">Rien ne tourne, rien n\'est prévu.</p>';
    return;
  }
  const shown = lanes.slice(0, NIGHT_LANES);
  const from = Math.min(view.now, ...shown.map((lane) => lane.start));
  const to = Math.max(view.now + 30 * 60_000, ...shown.map((lane) => lane.end));
  const x = (ms) => `${(((ms - from) / (to - from)) * 100).toFixed(2)}%`;
  const ticks = hoursOf(from, to).map((tick) => `<span class="tick" style="left: ${x(tick)}">${clockText(tick)}</span>`);
  const more = lanes.length > shown.length ? `<p class="more">… et ${lanes.length - shown.length} autres.</p>` : "";
  const projects = [...new Set(shown.map((one) => one.project))].map(project).join("");
  $("night").innerHTML = `<div class="axis">${ticks.join("")}<span class="now" style="left: ${x(view.now)}" title="maintenant"></span></div>
    ${shown.map((one) => laneHtml(one, x)).join("")}
    ${more}
    <p class="legend">${projects}<span>plein : en cours · hachuré : prévu</span></p>`;
}

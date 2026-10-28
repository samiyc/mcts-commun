// The backlog page's top (web/backlog.js): the machine in tiles, then what to look at.
import { alarmsOf, clockText, durationText, maybe, plural, relativeText, warningsOf } from "../node/backlog-text.js";

const hours = (value) => `${decimal(value)}<small> h</small>`;
import { $, decimal, escape, gauge, levelOf } from "./backlog-html.js";

function runnerTile(view) {
  const queue = view.runners.filter((one) => one.runner !== "session");
  const runner = queue.find((one) => one.alive) ?? queue[0];
  if (!runner) return ["Lanceur", '<span class="dot off"></span>aucun', "npx mcts-backlog pour jouer la file"];
  const since = runner.since ? durationText((view.now - Date.parse(runner.since)) / 60_000) : "";
  const state = runner.alive ? '<span class="dot on"></span>en marche' : '<span class="dot off"></span>arrêté';
  const waits = runner.waiting ? ` · attend ${runner.waiting.threads} fils pour ${escape(runner.waiting.id)} (${runner.waiting.free} libres)` : "";
  return ["Lanceur", state, `${escape(runner.runner)} pid ${runner.pid}${maybe(since, " · depuis ")}${waits}`];
}

function cpuTile(view) {
  const cpu = view.machine?.cpu;
  if (!cpu) return ["CPU", "?", "LibreHardwareMonitor ne répond pas"];
  return ["CPU", `${decimal(cpu.celsius)}<small> °C</small>`, gauge(cpu.celsius / 100, levelOf(cpu.celsius, 85, 75))];
}

/** Under 5 GB free the guard is near: bad; under 8, to watch. */
function memoryLevel(freeGb) {
  if (freeGb < 5) return "bad";
  return freeGb < 8 ? "warn" : "";
}

function memoryTile(view) {
  const ram = view.machine;
  if (!ram) return ["Mémoire libre", "?", ""];
  return ["Mémoire libre", `${decimal(ram.freeGb)}<small> / ${decimal(ram.totalGb)} Go</small>`, gauge(1 - ram.freeGb / ram.totalGb, memoryLevel(ram.freeGb))];
}

function todayTile(view) {
  const { doneToday, failedToday, cancelledToday } = view.counts;
  const cancelled = cancelledToday ? ` · ${cancelledToday} ${plural(cancelledToday, "annulé")}` : "";
  return ["Aujourd'hui", `${doneToday}<small> ${plural(doneToday, "fini")}</small>`, (failedToday ? `<span class="status-failed">${failedToday} en échec</span>` : "aucun échec") + cancelled];
}

function endTile(view) {
  const { nightEnd } = view.counts;
  return ["Fin de la file", nightEnd ? clockText(nightEnd) : "—", nightEnd ? relativeText(nightEnd, view.now) : "rien à venir"];
}

/** The load: the queue's hours learned from the archive, and at its estimates; whether it holds before 8:00. */
function loadTile(view) {
  const { load } = view;
  if (!load) return ["Charge", "?", ""];
  const measured = load.givenHours === load.queueHours ? "" : `${decimal(load.givenHours)} h annoncées · `;
  const morning = load.pastMorningMin > 0 ? `<span class="status-failed">${durationText(load.pastMorningMin)} après 8 h</span>` : "tient avant 8 h";
  return ["Charge de la file", hours(load.queueHours), measured + morning];
}

/** The machine in tiles: the runner, the threads, the CPU, the memory, today, the queue's end, its load. */
export function machine(view) {
  const { used, budget } = view.threads;
  const threads = ["Fils", `${used}<small> / ${budget}</small>`, gauge(used / budget, used > budget ? "bad" : "")];
  const tiles = [runnerTile(view), threads, cpuTile(view), memoryTile(view), todayTile(view), endTile(view), loadTile(view)];
  $("machine").innerHTML = tiles.map(([label, value, sub]) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`).join("");
}

/** What must be looked at (a dead runner, a blocked job, a crash) and what to keep an eye on. */
function alertsOf(view) {
  const bad = view.runners.filter((one) => !one.alive).map((runner) => `Le lanceur ${runner.pid} est mort : ses jobs « en cours » reprendront au prochain lancement.`);
  const warn = [];
  for (const job of view.running) {
    bad.push(...alarmsOf(job).map((alarm) => `${job.id} : ${alarm}`));
    warn.push(...warningsOf(job).map((warning) => `${job.id} : ${warning}`));
  }
  bad.push(...view.blocked.map((job) => `${job.id} est bloqué : ${job.reason}`));
  bad.push(...view.traces.filter((one) => one.ended?.kind === "crash").map((trace) => `${trace.id ?? trace.name} a planté : ${trace.ended.message ?? ""}`));
  const crashes = view.journal.filter((one) => one.kind === "crash" && view.now - Date.parse(one.at) < 86_400_000);
  bad.push(...crashes.map((entry) => `Le lanceur a planté à ${clockText(Date.parse(entry.at))} : ${entry.message}`));
  return { bad, warn };
}

const alertBlock = (items, level) => {
  if (!items.length) return "";
  const list = items.map((item) => `<li>${escape(item)}</li>`).join("");
  return `<div class="alert ${level}"><strong>${level === "bad" ? "À regarder" : "À surveiller"}</strong><ul>${list}</ul></div>`;
};

export function alerts(view) {
  const { bad, warn } = alertsOf(view);
  $("alerts").innerHTML = alertBlock(bad, "bad") + alertBlock(warn, "");
}

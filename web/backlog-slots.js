// The short tests beside the queue on the page (Sami, 28/10/2026: show the quick tests that pass through --slot):
// waiting for threads, running, ended lately, and the queue's jobs freed for them (node/backlog-slots.js).
import { durationText, stampText } from "../node/backlog-text.js";
import { $, badge, escape, project, table } from "./backlog-html.js";

const STATES = {
  waiting: () => badge("attend", "quiet"),
  running: () => badge("tourne", "ok"),
  done: () => badge("✔ fini", "ok"),
  failed: (test) => badge(`✖ code ${test.code}`, "bad"),
  stopped: () => badge("■ arrêté : trop long", "bad"),
  preempted: () => badge("⇄ job libéré"),
};

/** How long: waited so far, running so far, or taken; with the wait before it ran. */
function timeOf(test) {
  if (test.state === "waiting") return `attend depuis ${durationText(test.sinceMin)}${test.series ? ", en série (comme un job)" : ""}`;
  if (test.state === "running") return `depuis ${durationText(test.sinceMin)}`;
  if (test.state === "preempted") return "";
  return durationText(test.minutes);
}

function testRow(test, view) {
  const waited = test.waitedMin ? `<span class="hint">après ${durationText(test.waitedMin)} d'attente</span>` : "";
  const what = test.state === "preempted" ? `<span class="hint">job de la file, arrêté pour laisser sa place à un test</span>` : escape(test.command);
  return `<tr><td>${STATES[test.state](test)}</td><td>${test.project ? project(test.project) : ""}</td><td class="job">${escape(test.id)}</td>
      <td class="num">${test.threads}</td><td>${timeOf(test)} ${waited}</td><td>${test.stamp ? stampText(test.stamp, view.now) : ""}</td><td class="wrap">${what}</td></tr>`;
}

export function slots(view) {
  const tests = view.slots ?? [];
  const waiting = tests.filter((test) => test.state === "waiting").length;
  const running = tests.filter((test) => test.state === "running").length;
  $("slots-count").textContent = `(${waiting} en attente, ${running} en cours)`;
  if (waiting + running > 0) /** @type {HTMLDetailsElement} */ ($("slots-card")).open = true;
  const rows = tests.map((test) => testRow(test, view));
  $("slots").innerHTML = table(["", "Projet", "Test", ">Fils", "Durée", "Fin", "Commande"], rows, "Aucun test court : npx mcts-backlog --slot N -- commande, servi avant les jobs suivants de la file.");
}

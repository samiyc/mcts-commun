// Sami's ranking of the projects on the page (21/11/2026: « voyage en top 1, puis recrutement, puis codingame »): three
// lists and a button, POST /api/backlog/ranking (bin/serve.js, node/queue/ranking.js). Strict: a better-ranked
// project's jobs go first; the others after, by their own priorities. Drawn again only when the ranking changes and
// no list is being edited, so that the 2 s refresh never undoes a choice in progress.
import { PROJECTS } from "../../node/board/board.js";
import { $, escape } from "./html.js";

const TOPS = 3;
let shown = null;
let editing = false;
let note = "";

const optionsOf = (chosen) => ["", ...PROJECTS].map((name) => `<option value="${escape(name)}"${name === chosen ? " selected" : ""}>${name ? escape(name) : "—"}</option>`).join("");

const listOf = (i, chosen) => `<label class="rank">Top ${i + 1} <select data-top="${i}">${optionsOf(chosen)}</select></label>`;

/** The page's ranking card from the view's `ranking` (`{ projects, text, stale }`). */
export function ranking(view) {
  const projects = view.ranking?.projects ?? [];
  const stale = view.ranking?.stale ? "Le lanceur permanent, démarré avant le classement, ne l'applique pas encore : à redémarrer quand la file est vide." : "";
  $("ranking-stale").textContent = stale;
  const key = JSON.stringify(projects);
  if (editing || key === shown) return;
  shown = key;
  const more = projects.length > TOPS ? ` <span class="hint">puis ${escape(projects.slice(TOPS).join(", "))}</span>` : "";
  $("ranking").innerHTML = `${Array.from({ length: TOPS }, (_, i) => listOf(i, projects[i] ?? "")).join(" ")}${more} <button type="button" id="ranking-save">Enregistrer</button> <span id="ranking-note" class="hint">${escape(note)}</span>`;
}

/** Writes the three lists' choice (the blanks left out, beyond the third kept), then says what was written. */
async function save() {
  const chosen = [...document.querySelectorAll("#ranking select")].map((select) => /** @type {HTMLSelectElement} */ (select).value).filter(Boolean);
  const beyond = (JSON.parse(shown ?? "[]")).slice(TOPS).filter((name) => !chosen.includes(name));
  const answer = await fetch("/api/backlog/ranking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projects: [...chosen, ...beyond] }) });
  const body = await answer.json();
  editing = false;
  shown = null;
  note = answer.ok ? `enregistré à ${new Date().toLocaleTimeString("fr-FR")}` : body.error;
  $("ranking-note").textContent = note;
}

document.addEventListener("change", (event) => {
  if (/** @type {Element} */ (event.target).closest("#ranking select")) editing = true;
});
document.addEventListener("click", (event) => {
  if (/** @type {Element} */ (event.target).closest("#ranking-save")) save().catch((error) => ($("ranking-note").textContent = error.message));
});

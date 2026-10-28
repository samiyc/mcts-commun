// The backlog's page (Sami, 26/10/2026: the backlog was a black box): GET /api/backlog every 2 s (bin/serve.js), drawn,
// a module a section. The words are the terminal's (node/backlog-text.js imports nothing of Node: the page loads it).
import { board } from "./backlog-board.js";
import { $ } from "./backlog-html.js";
import { finished, held, running } from "./backlog-jobs.js";
import { journal, traces } from "./backlog-log.js";
import { alerts, machine } from "./backlog-machine.js";
import { night, nights } from "./backlog-night.js";
import { slots } from "./backlog-slots.js";

const REFRESH_MS = 2_000;
const dialog = () => /** @type {HTMLDialogElement} */ ($("tail"));

// The end of an output or a trace, followed while the dialog is open.
let following = null;
async function showTail() {
  if (!following) return;
  const id = encodeURIComponent(following.id);
  const response = await fetch(following.kind === "board" ? `/api/board?id=${id}` : `/api/backlog/tail?id=${id}&kind=${following.kind}`);
  const body = await response.json();
  const pre = $("tail-lines");
  const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
  $("tail-file").textContent = body.file ?? body.error ?? "";
  pre.textContent = body.lines?.join("\n") || "(vide pour l'instant)";
  if (atEnd) pre.scrollTop = pre.scrollHeight;
}
document.addEventListener("click", (event) => {
  const row = /** @type {HTMLElement} */ (/** @type {Element} */ (event.target).closest("tr.click"));
  // A button in a row (the board's "Lu") acts by itself, it does not open the row.
  if (!row || /** @type {Element} */ (event.target).closest("button")) return;
  following = { id: row.dataset.id, kind: row.dataset.kind };
  $("tail-title").textContent = row.dataset.id;
  $("tail-lines").textContent = "…";
  dialog().showModal();
  showTail().then(() => ($("tail-lines").scrollTop = $("tail-lines").scrollHeight));
});
$("tail-close").addEventListener("click", () => dialog().close());
dialog().addEventListener("close", () => (following = null));

async function refresh() {
  if (document.hidden) return;
  const pulse = $("pulse");
  try {
    const response = await fetch("/api/backlog", { cache: "no-store" });
    const view = await response.json();
    if (!response.ok) throw new Error(view.error ?? response.statusText);
    for (const draw of [machine, alerts, running, slots, night, nights, held, finished, journal, traces]) draw(view);
    // The board apart: a board that cannot be read leaves the backlog drawn.
    await fetch("/api/board", { cache: "no-store" })
      .then((answer) => answer.json())
      .then(board)
      .catch(() => {});
    await showTail();
    pulse.className = "pulse beat";
    pulse.textContent = `en direct · ${new Date(view.now).toLocaleTimeString("fr-FR")}`;
    setTimeout(() => pulse.classList.remove("beat"), 700);
  } catch (error) {
    pulse.className = "pulse stale";
    pulse.textContent = `serveur injoignable (${error.message})`;
  }
}
refresh();
setInterval(refresh, REFRESH_MS);
document.addEventListener("visibilitychange", refresh);

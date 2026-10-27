// The sessions' board on the page (Sami, 27/10/2026: five Claude sessions passed their news by copy and paste): its
// threads and who has not read what; posting is mcts-board's (docs/board.md). GET /api/board (bin/serve.js). One write:
// Sami marks his messages read, a thread's or all (POST /api/board/read), so that his reminders go.
import { threadState, when } from "../node/board-text.js";
import { $, badge, escape, project, table } from "./backlog-html.js";

function stateBadge(thread) {
  if (thread.done) return badge("fermé", "quiet");
  return thread.waiting.length ? badge(threadState(thread), "warn") : badge("lu", "ok");
}

/** A button marking Sami's messages read: of the thread `id`, or all of them. */
const readButton = (id, label) => `<button type="button" class="mark-read" data-read="${escape(id)}">${escape(label)}</button>`;

const threadRow = (thread) => `<tr class="click" data-id="${escape(thread.last.id)}" data-kind="board" title="Lire le fil">
      <td>${escape(when(thread.last.at))}</td><td>${project(thread.last.from)}</td><td>${thread.last.to.map(project).join(" ")}</td>
      <td class="wrap">${escape(thread.subject)}</td><td class="num">${thread.count}</td><td>${stateBadge(thread)}</td>
      <td>${thread.waiting.includes("sami") ? readButton(thread.id, "Lu") : ""}</td></tr>`;

/** Marks read the messages the button names, then draws the board again. */
async function markRead(button) {
  button.disabled = true;
  await fetch("/api/board/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(button.dataset.read ? { id: button.dataset.read } : {}) });
  board(await (await fetch("/api/board", { cache: "no-store" })).json());
}

document.addEventListener("click", (event) => {
  const button = /** @type {HTMLButtonElement | null} */ (/** @type {Element} */ (event.target).closest("button.mark-read"));
  if (button) markRead(button).catch(() => (button.disabled = false));
});

export function board(view) {
  const unread = Object.entries(view.unread)
    .filter(([, count]) => count > 0)
    .map(([reader, count]) => badge(`${reader} ${count}`, "warn"));
  $("board-count").textContent = `(${view.threads.length})`;
  $("board-unread").innerHTML = (unread.join("") || badge("rien", "ok")) + (view.unread.sami ? " " + readButton("", "Tout marquer lu pour sami") : "");
  const rows = view.threads.map(threadRow);
  $("board").innerHTML = table(["Dernier", "De", "À", "Sujet", ">Msg", "État", ""], rows, "Aucun message : les sessions postent par npx mcts-board --post.");
}

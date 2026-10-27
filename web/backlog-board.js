// The sessions' board on the page (Sami, 27/10/2026: five Claude sessions passed their news by copy and paste): its
// threads and who has not read what, read only; posting is mcts-board's (docs/board.md). GET /api/board (bin/serve.js).
import { threadState, when } from "../node/board-text.js";
import { $, badge, escape, project, table } from "./backlog-html.js";

function stateBadge(thread) {
  if (thread.done) return badge("fermé", "quiet");
  return thread.waiting.length ? badge(threadState(thread), "warn") : badge("lu", "ok");
}

const threadRow = (thread) => `<tr class="click" data-id="${escape(thread.last.id)}" data-kind="board" title="Lire le fil">
      <td>${escape(when(thread.last.at))}</td><td>${project(thread.last.from)}</td><td>${thread.last.to.map(project).join(" ")}</td>
      <td class="wrap">${escape(thread.subject)}</td><td class="num">${thread.count}</td><td>${stateBadge(thread)}</td></tr>`;

export function board(view) {
  const unread = Object.entries(view.unread)
    .filter(([, count]) => count > 0)
    .map(([reader, count]) => badge(`${reader} ${count}`, "warn"));
  $("board-count").textContent = `(${view.threads.length})`;
  $("board-unread").innerHTML = unread.join("") || badge("rien", "ok");
  const rows = view.threads.map(threadRow);
  $("board").innerHTML = table(["Dernier", "De", "À", "Sujet", ">Msg", "État"], rows, "Aucun message : les sessions postent par npx mcts-board --post.");
}

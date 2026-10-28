import { INVERSE, RESET, clip } from "./ansi.js";
import { clockText, loadShort, machineLine, stylesOf } from "./backlog-text.js";
import { detailOf } from "./tui-detail.js";
import { TABS, rowsOf } from "./tui-tabs.js";

/** The terminal view's screens (node/tui.js), as lines: the main one and the pager. Pure. */
const HELP = [
  "↑ ↓  j k        choisir une ligne        PgUp PgDn  g G   défiler, début, fin",
  "← →  Tab  1-7   changer d'onglet         Entrée           la sortie (ou la trace) en plein écran",
  "/               filtrer (Échap efface)   r                relire maintenant",
  "?               cette aide               q  Ctrl+C        quitter",
  "l  L            (onglet Messages) marquer lus pour sami les messages du fil choisi, ou tous",
  "",
  "Lecture seule : le lanceur peut tourner, rien ici n'écrit dans ses fichiers ; seuls l et L écrivent, dans le tableau.",
  "Une trace bat toutes les 30 s : muette depuis 2 min, le job est sans doute coincé dans un calcul.",
];

/** The two lines on top: the machine, then the day and the queue's end. */
function headLines(view, s) {
  const { doneToday, failedToday, cancelledToday, nightEnd } = view.counts;
  const failed = (failedToday ? s.red(failedToday + " en échec") : "0 en échec") + (cancelledToday ? `, ${cancelledToday} annulé(s)` : "");
  const end = (nightEnd ? " · la file finirait vers " + clockText(nightEnd) : "") + (view.load ? " · " + loadShort(view.load) : "");
  return [`${s.inverse(s.bold(" mcts-backlog "))} ${machineLine(view, s)}`, s.gray(` ${new Date(view.now).toLocaleTimeString("fr-FR")} · aujourd'hui ${doneToday} fini(s), ${failed}${end}`)];
}

function tabsLine(view, ui, s) {
  const labels = TABS.map((tab, index) => {
    const label = ` ${index + 1} ${tab.title} ${rowsOf(view, index, ui.filter).length} `;
    return index === ui.tab ? s.inverse(s.bold(label)) : s.gray(label);
  });
  // The filter first: seven tabs fill a narrow terminal, and what is cut must not be what was typed.
  return (ui.filter ? s.yellow(" filtre : " + ui.filter + " ") : "") + labels.join(" ");
}

/** Keeps the row chosen inside the list and in sight among `shown` rows. */
function scroll(ui, length, shown) {
  ui.selected = Math.max(0, Math.min(ui.selected, length - 1));
  if (ui.selected < ui.offset) ui.offset = ui.selected;
  if (ui.selected >= ui.offset + shown) ui.offset = ui.selected - shown + 1;
  ui.offset = Math.max(0, Math.min(ui.offset, Math.max(0, length - shown)));
}

/** A row of the table; the one chosen in inverse video from end to end, through the resets of its own colours. */
function rowLine(row, chosen, { tab, widths, s, view, ui, cols }) {
  const text = ` ${tab.line(row, widths, s, view.now)}`;
  if (!chosen) return text;
  return ui.color === false ? `›${text.slice(1)}` : INVERSE + clip(text, cols).replaceAll(RESET, RESET + INVERSE);
}

function tableLines(list, shown, context) {
  const { tab, ui, s, cols } = context;
  const lines = [s.bold(` ${tab.head(context.widths)}`)];
  for (let i = 0; i < shown; i += 1) {
    const row = list[ui.offset + i];
    if (row) lines.push(rowLine(row, ui.offset + i === ui.selected, context));
    else lines.push(i === 0 ? s.gray("  " + (tab.empty ?? "(vide)")) : "");
  }
  const more = list.length > shown ? ` ${ui.offset + 1}-${Math.min(list.length, ui.offset + shown)} sur ${list.length} ` : "";
  lines.push(s.gray(`─${more}${"─".repeat(Math.max(0, cols - more.length - 2))}`));
  return lines;
}

function keysLine(ui, s) {
  if (ui.typing) return `${s.yellow("/")}${ui.filter}${s.inverse(" ")}  ${s.gray("Entrée garde, Échap efface")}`;
  if (ui.message) return s.red(ui.message);
  if (ui.tab === TABS.findIndex((tab) => tab.title === "Messages")) return s.gray(" ↑↓ choisir  Entrée le dernier message  l lu pour sami (fil)  L tout lu  ? aide  q quitter");
  return s.gray(" ↑↓ choisir  ←→ onglets  Entrée sortie  / filtrer  ? aide  q quitter   (lecture seule)");
}

/**
 * The screen as `rows` lines `cols` wide: the machine, the tabs, the table, the panel, the keys. `ui`: `{ tab,
 * selected, offset, filter, typing, help, message, tail, color }`; `offset` is moved to keep the row chosen in sight.
 */
export function screenOf(view, ui, { cols, rows }) {
  const s = stylesOf(ui.color !== false);
  const list = rowsOf(view, ui.tab, ui.filter);
  const widths = { id: Math.max(12, Math.min(46, Math.floor(cols * 0.35), Math.max(0, ...list.map((row) => (row.id ?? row.name ?? "").length)))) };
  const room = rows - 6;
  const shown = Math.max(3, Math.round(room * (ui.help ? 0.4 : 0.55)));
  scroll(ui, list.length, shown);
  const panel = ui.help ? HELP : detailOf(ui.tab, list[ui.selected], { view, s, tail: ui.tail });
  const panelRows = Array.from({ length: Math.max(0, room - shown) }, (_, i) => (panel[i] === undefined ? "" : ` ${panel[i]}`));
  const lines = [...headLines(view, s), tabsLine(view, ui, s), ...tableLines(list, shown, { tab: TABS[ui.tab], widths, s, view, ui, cols }), ...panelRows, keysLine(ui, s)];
  return lines.slice(0, rows).map((line, i) => clip(line, i === rows - 1 ? cols - 1 : cols));
}

/** The pager: `lines` from `top`, a title, the keys. */
export function pagerOf(pager, { cols, rows }, color = true) {
  const { title, lines, top } = pager;
  const s = stylesOf(color);
  const body = lines.slice(top, top + rows - 2);
  const out = [s.inverse(s.bold(` ${title} `)) + s.gray(` ${Math.min(lines.length, top + 1)}-${Math.min(lines.length, top + rows - 2)} sur ${lines.length}`)];
  for (let i = 0; i < rows - 2; i += 1) out.push(body[i] ?? "");
  // A message from the Messages tab: l first, before a narrow screen cuts the line.
  const keys = pager.thread ? " l lu pour sami · ↑↓ PgUp PgDn défiler · q Échap retour" : " ↑↓ PgUp PgDn g G défiler · en bas, la sortie suit · q Échap retour";
  out.push(pager.note ? s.yellow(` ${pager.note}`) : s.gray(keys));
  return out.map((line, i) => clip(line, i === rows - 1 ? cols - 1 : cols));
}

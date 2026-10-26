import path from "node:path";
import readline from "node:readline";
import { readBacklog, viewOf } from "./backlog-view.js";
import { clockText, durationText, fit, machineLine, progressText, relativeText, stampText, statusOf, stylesOf, warningsOf } from "./backlog-text.js";
import { tailOf } from "./tail.js";

/**
 * `mcts-backlog --tui`: the machine's backlog in a terminal view that follows it live, after k9s and lazydocker (Sami,
 * 26/10/2026: `--list` was obscure). Read only: the runner may be at work, nothing here writes to its files. Drawn
 * with plain ANSI codes, no dependency; refreshed every 2 s.
 *
 * `screenOf(view, ui, size)` lays the screen out as lines (pure, tested); `runTui` reads the keys and draws.
 */
const REFRESH_MS = 2_000;

/** `text` (colour codes allowed) cut or padded to `width` visible characters. */
export function clip(text, width) {
  let out = "";
  let shown = 0;
  for (const part of String(text).split(/(\x1b\[[0-9;?]*[A-Za-z])/)) {
    if (part.startsWith("\x1b[")) {
      out += part;
      continue;
    }
    const room = width - shown;
    if (room <= 0) continue;
    const kept = part.length > room ? `${part.slice(0, Math.max(0, room - 1))}…` : part;
    out += kept;
    shown += kept.length;
  }
  return `${out}${out.includes("\x1b[") ? "\x1b[0m" : ""}${" ".repeat(Math.max(0, width - shown))}`;
}

const KIND_WORDS = {
  "runner-started": ["lanceur démarré", "green"],
  "runner-ended": ["lanceur fini", "green"],
  "job-started": ["job lancé", "cyan"],
  "job-ended": ["job fini", "white"],
  "job-requeued": ["remis en file", "yellow"],
  "slot-waiting": ["attend des fils", "gray"],
  "heat-alert": ["garde thermique", "red"],
  "heat-resumed": ["reprise au frais", "green"],
  "memory-stop": ["garde mémoire", "red"],
  "orphans-requeued": ["orphelins repris", "yellow"],
  "queue-retried": ["file réécrite", "gray"],
  "queue-refused": ["file refusée", "red"],
  added: ["ajouté", "blue"],
  crash: ["plantage", "red"],
};
const kindOf = (kind) => KIND_WORDS[kind] ?? [kind, "white"];
const localTime = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(",", "") : "?");

/** A journal entry in a few words. */
function journalText(entry) {
  const { kind } = entry;
  if (kind === "job-ended") return `${entry.id} : ${statusOf(entry.status).word}, ${durationText(entry.minutes)}${entry.reason ? ` (${entry.reason})` : ""}`;
  if (kind === "job-started") return `${entry.id} (${entry.threads} fil${entry.threads > 1 ? "s" : ""}, pid ${entry.childPid ?? "?"})`;
  if (kind === "runner-started") return `${entry.budget} fils au plus${entry.cpu ? `, CPU ${entry.cpu.celsius} °C` : ""}`;
  if (kind === "slot-waiting") return `${entry.id} : ${entry.threads} fil(s), ${entry.slots?.length ?? 0} job(s) tournent`;
  if (kind === "heat-alert") return `${entry.celsius} °C, ${entry.stopping?.length ?? 0} job(s) arrêtés`;
  if (kind === "memory-stop") return `${entry.id} : ${entry.freeGb} Go libres`;
  if (kind === "crash") return entry.message;
  if (entry.ids) return entry.ids.join(", ");
  return entry.id ?? entry.message ?? "";
}

/** How a trace file stands: beating, ended, crashed, silent. */
function traceState(trace, s) {
  if (trace.ended?.kind === "crash") return s.red("✖ planté");
  if (trace.ended) return trace.ended.code === 0 ? s.green("✔ fini") : s.yellow(`■ fini (${trace.ended.code})`);
  if (trace.quietMin !== null && trace.quietMin >= 2) return s.yellow(`◌ muet ${durationText(trace.quietMin)}`);
  return s.green("● bat");
}
const countersText = (counters = {}) =>
  Object.entries(counters)
    .map(([scope, one]) => `${scope} ${one.calls ?? 0}${one.errors ? ` ✖${one.errors}` : ""}${one.slow ? ` ⧗${one.slow}` : ""}`)
    .join("  ");

/** The tabs: what each lists, its columns, and what the panel below says of the row chosen. */
export const TABS = [
  {
    title: "En cours",
    rows: (view) => view.running,
    head: (w) => ["", "projet", "job", "fils", "avancement", "à surveiller"].map((one, i) => fit(one, [2, 10, w.id, 5, 24, 40][i])).join(" "),
    line: (job, w, s) => {
      const warnings = warningsOf(job);
      return `${s.cyan("▶")}  ${fit(job.project, 10)} ${fit(job.id, w.id)} ${fit(job.threads, 5)} ${clip(progressText(job, s), 24)} ${warnings.length ? s.yellow(warnings.join(", ")) : s.gray(job.lastLine)}`;
    },
  },
  {
    title: "À venir",
    rows: (view) => view.planned,
    head: (w) => ["début", "", "projet", "job", "durée", "notes"].map((one, i) => fit(one, [6, 14, 10, w.id, 8, 30][i])).join(" "),
    line: (job, w, s, now) => {
      const tags = [job.priority !== 2 ? `priorité ${job.priority}` : "", job.threads > 1 ? `${job.threads} fils` : "", job.due ? `pour ${job.due}` : "", job.after.length ? `après ${job.after.join(", ")}` : ""].filter(Boolean).join(", ");
      return `${fit(clockText(job.start), 6)} ${s.gray(fit(relativeText(job.start, now), 14))} ${fit(job.project, 10)} ${fit(job.id, w.id)} ${fit(durationText(job.estimateMin), 8)} ${job.late ? s.red("en retard sur son échéance ") : ""}${s.gray(tags)}`;
    },
  },
  {
    title: "Bloqués",
    rows: (view) => [...view.blocked, ...view.waiting],
    head: (w) => ["", "projet", "job", "pourquoi"].map((one, i) => fit(one, [2, 10, w.id, 40][i])).join(" "),
    line: (job, w, s) => `${job.blocked ? s.red("■") : s.gray("◷")}  ${fit(job.project, 10)} ${fit(job.id, w.id)} ${job.blocked ? s.red(job.reason) : s.gray(job.reason)}`,
  },
  {
    title: "Finis",
    rows: (view) => view.finished,
    head: (w) => ["", "fin", "projet", "job", "durée", "estimé", ""].map((one, i) => fit(one, [2, 12, 10, w.id, 8, 9, 20][i])).join(" "),
    line: (job, w, s, now) => {
      const status = statusOf(job.status);
      return `${s[status.color](status.icon)}  ${fit(stampText(job.doneAt, now), 12)} ${fit(job.project, 10)} ${fit(job.id, w.id)} ${fit(durationText(job.minutes), 8)} ${s.gray(fit(durationText(job.estimateMin), 9))} ${job.reason ? s.red(job.reason) : ""}`;
    },
  },
  {
    title: "Journal",
    rows: (view) => view.journal,
    empty: "Aucun journal : le lanceur qui tourne date d'avant le 26/10 ; il en écrira un à son prochain démarrage.",
    head: () => ["quand", "quoi", "détail"].map((one, i) => fit(one, [15, 18, 40][i])).join(" "),
    line: (entry, w, s) => {
      const [word, color] = kindOf(entry.kind);
      return `${s.gray(fit(localTime(entry.at), 15))} ${s[color](fit(word, 18))} ${journalText(entry)}`;
    },
  },
  {
    title: "Traces",
    rows: (view) => view.traces,
    empty: "Aucune trace : les jobs d'un lanceur d'après le 26/10 en écrivent une, et MCTS_TRACE=1 à la main dans logs/ du projet.",
    head: (w) => ["état", "trace", "appels de la bibliothèque"].map((one, i) => fit(one, [14, w.id + 18, 40][i])).join(" "),
    line: (trace, w, s) => `${clip(traceState(trace, s), 14)} ${fit(trace.id ?? trace.name, w.id + 18)} ${trace.problems.length ? s.red(`${trace.problems.length} incident(s)  `) : ""}${s.gray(countersText(trace.counters))}`,
  },
];

const textOf = (row) => [row.id, row.project, row.command, row.reason, row.kind, row.name, row.message].filter(Boolean).join(" ").toLowerCase();
/** The rows of tab `index`, the filter applied. */
export const rowsOf = (view, index, filter = "") => TABS[index].rows(view).filter((row) => !filter || textOf(row).includes(filter.toLowerCase()));

/** What the panel below the table says of `row`, as lines; `tail` is the end of its output or trace. */
function detailOf(index, row, view, s, tail) {
  if (!row) return [s.gray("Rien à montrer ici.")];
  const field = (name, value) => (value === null || value === undefined || value === "" ? [] : [`${s.gray(fit(name, 10))} ${value}`]);
  const lines = [];
  if (index <= 3) {
    lines.push(`${s.bold(row.id)}  ${s.gray(row.project)}`);
    lines.push(...field("commande", row.command), ...field("dossier", row.cwd));
  }
  if (index === 0) {
    lines.push(...field("depuis", `${stampText(row.startedAt, view.now)} · ${durationText(row.elapsedMin)} sur ${durationText(row.estimateMin)} estimées · limite ${durationText(row.limitMin)}`));
    lines.push(...field("processus", `lanceur ${row.runnerPid ?? "?"}${row.orphan ? s.red(" (mort)") : ""}${row.childPid ? ` · job ${row.childPid}` : ""}`));
    lines.push(...field("sortie", row.output ? `${row.output}${row.quietMin !== null ? s.gray(` · écrite ${relativeText(view.now - row.quietMin * 60_000, view.now)}`) : ""}` : null));
    lines.push(...field("trace", row.beatMin !== null ? `dernier battement ${relativeText(view.now - row.beatMin * 60_000, view.now)}` : s.gray("aucune (lanceur d'avant le 26/10, ou job sans la bibliothèque)")));
    const warnings = warningsOf(row);
    if (warnings.length) lines.push(...field("attention", s.yellow(warnings.join(", "))));
  }
  if (index === 1) lines.push(...field("prévu", `${clockText(row.start)} → ${clockText(row.end)} (${durationText(row.estimateMin)})${row.late ? s.red(" en retard sur son échéance") : ""}`), ...field("échéance", row.due), ...field("après", row.after.join(", ")), ...field("priorité", row.priority));
  if (index === 2) lines.push(...field("pourquoi", row.blocked ? s.red(row.reason) : row.reason), ...field("après", row.after.join(", ")));
  if (index === 3) {
    const status = statusOf(row.status);
    lines.push(...field("fin", `${s[status.color](`${status.icon} ${status.word}`)} ${stampText(row.doneAt, view.now)} · ${durationText(row.minutes)} (estimé ${durationText(row.estimateMin)})`), ...field("raison", row.reason && s.red(row.reason)), ...field("sortie", row.output), ...field("trace", row.trace));
  }
  if (index === 4) {
    const [word, color] = kindOf(row.kind);
    lines.push(`${s[color](s.bold(word))}  ${s.gray(localTime(row.at))} ${s.gray(`pid ${row.pid}`)}`);
    for (const [key, value] of Object.entries(row)) if (!["at", "kind", "pid"].includes(key)) lines.push(...field(key, typeof value === "object" ? JSON.stringify(value) : value));
  }
  if (index === 5) {
    lines.push(`${s.bold(row.id ?? row.name)}  ${traceState(row, s)}`);
    lines.push(...field("fichier", row.file), ...field("lancé", row.start ? `${localTime(row.start.at)} · ${(row.start.argv ?? []).join(" ")}` : null), ...field("battement", row.lastBeat ? `${localTime(row.lastBeat.at)}${row.lastBeat.rssMb ? ` · ${row.lastBeat.rssMb} Mo` : ""}` : null));
    for (const [scope, one] of Object.entries(row.counters ?? {})) {
      const extra = Object.entries(one).filter(([key]) => !["calls", "ms", "maxMs", "errors", "slow"].includes(key)).map(([key, value]) => `${key} ${value}`).join(", ");
      lines.push(...field(scope, `${one.calls} appels · ${durationText(one.ms / 60_000)} · le plus long ${Math.round(one.maxMs)} ms${one.errors ? s.red(` · ${one.errors} erreur(s)`) : ""}${one.slow ? s.yellow(` · ${one.slow} lent(s)`) : ""}${extra ? s.gray(` · ${extra}`) : ""}`));
    }
    for (const problem of row.problems.slice(-8)) lines.push(`${s.gray(localTime(problem.at))} ${problem.kind === "slow" ? s.yellow("lent") : s.red(problem.kind)} ${problem.scope} ${problem.message ?? ""}${problem.ms ? ` ${problem.ms} ms` : ""}`);
  }
  if (tail?.length) {
    lines.push(s.gray(`── fin de ${index === 5 ? "la trace" : "la sortie"} ${"─".repeat(40)}`));
    lines.push(...tail.map((line) => s.gray(line)));
  }
  return lines;
}

/** The file whose end the panel shows for `row`: a job's output, a trace. */
export function fileOf(index, row, home) {
  if (!row) return null;
  if (index === 0) return row.output;
  if (index === 3 && row.output) return path.join(home, row.output);
  if (index === 5) return row.file;
  return null;
}

const HELP = [
  "↑ ↓  j k        choisir une ligne        PgUp PgDn  g G   défiler, début, fin",
  "← →  Tab  1-6   changer d'onglet         Entrée           la sortie (ou la trace) en plein écran",
  "/               filtrer (Échap efface)   r                relire maintenant",
  "?               cette aide               q  Ctrl+C        quitter",
  "",
  "Lecture seule : le lanceur peut tourner, rien ici n'écrit dans ses fichiers.",
  "Une trace bat toutes les 30 s : muette depuis 2 min, le job est sans doute coincé dans un calcul.",
];

/**
 * The screen as `rows` lines `cols` wide: the machine, the tabs, the table, the panel, the keys. `ui`: `{ tab,
 * selected, offset, filter, typing, help, message, tail, color }`; `offset` is moved to keep the row chosen in sight.
 */
export function screenOf(view, ui, { cols, rows }) {
  const s = stylesOf(ui.color !== false);
  const lines = [];
  lines.push(`${s.inverse(s.bold(" mcts-backlog "))} ${machineLine(view, s)}`);
  const { doneToday, failedToday, nightEnd } = view.counts;
  lines.push(s.gray(` ${new Date(view.now).toLocaleTimeString("fr-FR")} · aujourd'hui ${doneToday} fini(s), ${failedToday ? s.red(`${failedToday} en échec`) : "0 en échec"}${nightEnd ? ` · la file finirait vers ${clockText(nightEnd)}` : ""}`));
  lines.push(
    TABS.map((tab, index) => {
      const label = ` ${index + 1} ${tab.title} ${rowsOf(view, index, ui.filter).length} `;
      return index === ui.tab ? s.inverse(s.bold(label)) : s.gray(label);
    }).join(" ") + (ui.filter ? s.yellow(`  filtre : ${ui.filter}`) : ""),
  );
  const list = rowsOf(view, ui.tab, ui.filter);
  const widths = { id: Math.max(12, Math.min(46, Math.floor(cols * 0.35), Math.max(0, ...list.map((row) => (row.id ?? row.name ?? "").length)))) };
  const tab = TABS[ui.tab];
  const room = rows - 6;
  const tableRows = Math.max(3, Math.round(room * (ui.help ? 0.4 : 0.55)));
  const panelRows = Math.max(0, room - tableRows);
  ui.selected = Math.max(0, Math.min(ui.selected, list.length - 1));
  if (ui.selected < ui.offset) ui.offset = ui.selected;
  if (ui.selected >= ui.offset + tableRows) ui.offset = ui.selected - tableRows + 1;
  ui.offset = Math.max(0, Math.min(ui.offset, Math.max(0, list.length - tableRows)));
  lines.push(s.bold(` ${tab.head(widths)}`));
  for (let i = 0; i < tableRows; i += 1) {
    const row = list[ui.offset + i];
    if (!row) lines.push(i === 0 ? s.gray(`  ${tab.empty ?? "(vide)"}`) : "");
    else {
      const text = ` ${tab.line(row, widths, s, view.now)}`;
      const chosen = ui.offset + i === ui.selected;
      // The row chosen in inverse video from end to end, through the resets of its own colours.
      lines.push(chosen && ui.color !== false ? `\x1b[7m${clip(text, cols).replace(/\x1b\[0m/g, "\x1b[0m\x1b[7m")}` : chosen ? `›${text.slice(1)}` : text);
    }
  }
  const more = list.length > tableRows ? ` ${ui.offset + 1}-${Math.min(list.length, ui.offset + tableRows)} sur ${list.length} ` : "";
  lines.push(s.gray(`─${more}${"─".repeat(Math.max(0, cols - more.length - 2))}`));
  const panel = ui.help ? HELP.map((line) => ` ${line}`) : detailOf(ui.tab, list[ui.selected], view, s, ui.tail).map((line) => ` ${line}`);
  for (let i = 0; i < panelRows; i += 1) lines.push(panel[i] ?? "");
  const keys = ui.typing ? `${s.yellow("/")}${ui.filter}${s.inverse(" ")}  ${s.gray("Entrée garde, Échap efface")}` : ui.message ? s.red(ui.message) : s.gray(" ↑↓ choisir  ←→ onglets  Entrée sortie  / filtrer  ? aide  q quitter   (lecture seule)");
  lines.push(keys);
  return lines.slice(0, rows).map((line, i) => clip(line, i === rows - 1 ? cols - 1 : cols));
}

/** The pager: `lines` from `top`, a title, the keys. */
export function pagerOf(title, lines, top, { cols, rows }, color = true) {
  const s = stylesOf(color);
  const body = lines.slice(top, top + rows - 2);
  const out = [s.inverse(s.bold(` ${title} `)) + s.gray(` ${Math.min(lines.length, top + 1)}-${Math.min(lines.length, top + rows - 2)} sur ${lines.length}`)];
  for (let i = 0; i < rows - 2; i += 1) out.push(body[i] ?? "");
  out.push(s.gray(" ↑↓ PgUp PgDn g G défiler · en bas, la sortie suit · q Échap retour"));
  return out.map((line, i) => clip(line, i === rows - 1 ? cols - 1 : cols));
}

/** Runs the terminal view on `home` until q. */
export async function runTui({ home, budget }) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("--tui demande un terminal (essayer --list)");
  const ui = { tab: 0, selected: 0, offset: 0, filter: "", typing: false, help: false, message: "", tail: [], color: !process.env.NO_COLOR };
  const chosen = new Map();
  let view = null;
  let pager = null;
  let loading = false;
  const size = () => ({ cols: stdout.columns || 120, rows: stdout.rows || 40 });

  const draw = () => {
    if (!view) return;
    const lines = pager ? pagerOf(pager.title, pager.lines, pager.top, size(), ui.color) : screenOf(view, ui, size());
    stdout.write(lines.map((line, i) => `\x1b[${i + 1};1H${line}`).join("") + "\x1b[J");
    const row = rowsOf(view, ui.tab, ui.filter)[ui.selected];
    if (row) chosen.set(ui.tab, row.id ?? row.name ?? row.at);
  };
  const pagerRows = () => size().rows - 2;
  const loadTail = async () => {
    const file = view && fileOf(ui.tab, rowsOf(view, ui.tab, ui.filter)[ui.selected], home);
    ui.tail = file ? await tailOf(file, { lines: 60 }) : [];
    if (pager?.file) {
      const atEnd = pager.top >= pager.lines.length - pagerRows();
      pager.lines = await tailOf(pager.file, { lines: 5000, bytes: 2 * 1024 * 1024 });
      if (atEnd) pager.top = Math.max(0, pager.lines.length - pagerRows());
    }
  };
  const load = async () => {
    if (loading) return;
    loading = true;
    try {
      view = viewOf(await readBacklog(home, { budget }));
      // Keep the row chosen on its job when the list moves.
      const id = chosen.get(ui.tab);
      const index = rowsOf(view, ui.tab, ui.filter).findIndex((row) => (row.id ?? row.name ?? row.at) === id);
      if (index >= 0) ui.selected = index;
      await loadTail();
      ui.message = "";
    } catch (error) {
      ui.message = `lecture impossible : ${error.message}`;
    } finally {
      loading = false;
    }
    draw();
  };
  const restore = () => stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l");
  const quit = () => {
    clearInterval(timer);
    restore();
    stdin.setRawMode(false);
    stdin.pause();
    finish();
  };
  let finish;
  const done = new Promise((resolve) => (finish = resolve));

  const choose = async (move) => {
    move();
    ui.tail = [];
    draw();
    await loadTail();
    draw();
  };
  const onKey = async (text, key = {}) => {
    const name = key.name ?? text;
    if (key.ctrl && name === "c") return quit();
    if (pager) {
      const page = pagerRows();
      const last = Math.max(0, pager.lines.length - page);
      if (name === "q" || name === "escape" || name === "return") pager = null;
      else if (name === "down" || name === "j") pager.top = Math.min(last, pager.top + 1);
      else if (name === "up" || name === "k") pager.top = Math.max(0, pager.top - 1);
      else if (name === "pagedown" || name === "space") pager.top = Math.min(last, pager.top + page);
      else if (name === "pageup") pager.top = Math.max(0, pager.top - page);
      else if (name === "g" && !key.shift) pager.top = 0;
      else if (name === "end" || (name === "g" && key.shift) || text === "G") pager.top = last;
      return draw();
    }
    if (ui.typing) {
      if (name === "return") ui.typing = false;
      else if (name === "escape") Object.assign(ui, { typing: false, filter: "" });
      else if (name === "backspace") ui.filter = ui.filter.slice(0, -1);
      else if (text && text.length === 1 && text >= " ") ui.filter += text;
      ui.selected = 0;
      return choose(() => {});
    }
    const count = view ? rowsOf(view, ui.tab, ui.filter).length : 0;
    const page = Math.max(3, Math.round((size().rows - 6) * 0.55));
    if (name === "q") return quit();
    if (name === "escape") return choose(() => Object.assign(ui, { help: false, filter: "" }));
    if (text === "?") return choose(() => (ui.help = !ui.help));
    if (text === "/") return choose(() => Object.assign(ui, { typing: true, filter: "" }));
    if (name === "r") return load();
    if (name === "down" || name === "j") return choose(() => (ui.selected = Math.min(count - 1, ui.selected + 1)));
    if (name === "up" || name === "k") return choose(() => (ui.selected = Math.max(0, ui.selected - 1)));
    if (name === "pagedown") return choose(() => (ui.selected = Math.min(count - 1, ui.selected + page)));
    if (name === "pageup") return choose(() => (ui.selected = Math.max(0, ui.selected - page)));
    if (name === "home" || (name === "g" && !key.shift)) return choose(() => (ui.selected = 0));
    if (name === "end" || text === "G") return choose(() => (ui.selected = count - 1));
    const tabTo = (index) => choose(() => Object.assign(ui, { tab: (index + TABS.length) % TABS.length, selected: 0, offset: 0 }));
    if (name === "right" || (name === "tab" && !key.shift)) return tabTo(ui.tab + 1);
    if (name === "left" || (name === "tab" && key.shift)) return tabTo(ui.tab - 1);
    if (/^[1-6]$/.test(text ?? "")) return tabTo(Number(text) - 1);
    if (name === "return" && view) {
      const row = rowsOf(view, ui.tab, ui.filter)[ui.selected];
      const file = fileOf(ui.tab, row, home);
      if (!file) return;
      pager = { file, title: path.basename(file), lines: [], top: 0 };
      pager.lines = await tailOf(file, { lines: 5000, bytes: 2 * 1024 * 1024 });
      pager.top = Math.max(0, pager.lines.length - pagerRows());
      return draw();
    }
  };

  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("keypress", (text, key) => {
    onKey(text, key).catch((error) => {
      ui.message = error.message;
      draw();
    });
  });
  stdout.on("resize", draw);
  process.on("exit", restore);
  stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");
  stdout.write(`\x1b[1;1H${stylesOf(ui.color).gray(" lecture de la backlog…")}`);
  const timer = setInterval(load, REFRESH_MS);
  await load();
  return done;
}

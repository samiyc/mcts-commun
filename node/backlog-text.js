/**
 * The backlog in a terminal's words (Sami, 26/10/2026: `--list` was obscure): durations, clocks, bars, the colours of
 * a status, and `listText`, what `mcts-backlog --list` prints. The terminal view (node/tui.js) draws with the same.
 */
const CODES = { bold: [1, 22], dim: [2, 22], inverse: [7, 27], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39], gray: [90, 39], white: [97, 39] };

/** Styles as functions (`styles.red("x")`); plain text when `enabled` is false. */
export function stylesOf(enabled) {
  return Object.fromEntries(Object.entries(CODES).map(([name, [on, off]]) => [name, (text) => (enabled ? `\x1b[${on}m${text}\x1b[${off}m` : String(text))]));
}

/** Colours wanted on `stream`: a terminal, and no NO_COLOR. */
export const colorsOn = (stream = process.stdout, env = process.env) => Boolean(stream.isTTY) && !env.NO_COLOR;

export const STATUS = {
  running: { icon: "▶", color: "cyan", word: "en cours" },
  todo: { icon: "·", color: "gray", word: "à faire" },
  scheduled: { icon: "◷", color: "gray", word: "programmé" },
  done: { icon: "✔", color: "green", word: "fait" },
  failed: { icon: "✖", color: "red", word: "échec" },
  timeout: { icon: "⧗", color: "yellow", word: "trop long" },
  skipped: { icon: "↷", color: "gray", word: "sauté" },
};
export const statusOf = (status) => STATUS[status] ?? { icon: "?", color: "white", word: status };

/** "< 1 min", "34 min", "2 h 05". */
export function durationText(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "?";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const whole = Math.round(minutes);
  return `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, "0")}`;
}

/** "18:40" in local time. */
export const clockText = (ms) => (Number.isFinite(ms) ? new Date(ms).toTimeString().slice(0, 5) : "--:--");

/** "dans 25 min", "il y a 3 min". */
export function relativeText(ms, now) {
  const minutes = (ms - now) / 60_000;
  return minutes >= 0 ? `dans ${durationText(minutes)}` : `il y a ${durationText(-minutes)}`;
}

/** A local stamp ("2026-10-26T18:57") as "26/10 18:57", or "18:57" on `now`'s day. */
export function stampText(stamp, now = Date.now()) {
  if (!stamp) return "?";
  const day = new Date(now - new Date(now).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return stamp.startsWith(day) ? stamp.slice(11, 16) : `${stamp.slice(8, 10)}/${stamp.slice(5, 7)} ${stamp.slice(11, 16)}`;
}

/** A bar `width` wide, `fraction` of it full (clipped to 1). */
export function bar(fraction, width) {
  const full = Math.max(0, Math.min(width, Math.round((Number.isFinite(fraction) ? fraction : 0) * width)));
  return "█".repeat(full) + "░".repeat(width - full);
}

/** `text` cut with an ellipsis or padded to `width` characters (plain text, no colour codes). */
export function fit(text, width, align = "left") {
  const plain = String(text ?? "").replace(/[\r\n\t]+/g, " ");
  if (width <= 0) return "";
  const cut = plain.length > width ? `${plain.slice(0, Math.max(0, width - 1))}…` : plain;
  return align === "right" ? cut.padStart(width) : cut.padEnd(width);
}

const decimal = (value) => String(value).replace(".", ",");

/** The machine in one line: runners, threads, CPU, memory. */
export function machineLine(view, s) {
  const runners = view.runners.length
    ? view.runners.map((one) => `${one.alive ? s.green("●") : s.red("○")} ${one.runner} ${one.pid}${one.since ? ` depuis ${durationText((view.now - Date.parse(one.since)) / 60_000)}` : ""}`).join("  ")
    : `${s.gray("○")} aucun lanceur`;
  const { used, budget } = view.threads;
  const machine = view.machine;
  const cpu = machine?.cpu ? `CPU ${decimal(machine.cpu.celsius)} °C` : "CPU ?";
  const hot = machine?.cpu && machine.cpu.celsius >= 85 ? s.red(cpu) : cpu;
  const ram = machine ? `RAM ${decimal(machine.freeGb)}/${decimal(machine.totalGb)} Go libres` : "";
  return [runners, `fils ${s.cyan(bar(used / budget, 10))} ${used}/${budget}`, hot, ram].filter(Boolean).join(s.gray("  ·  "));
}

/** A running job's progress: "██████░░░░ 34/45 min", in yellow past its estimate. */
export function progressText(job, s, width = 10) {
  const text = `${bar(job.progress, width)} ${Math.round(job.elapsedMin)}/${Math.round(job.estimateMin)} min`;
  return job.over ? s.yellow(text) : s.cyan(text);
}

/**
 * What is odd about a running job: its runner gone, near its limit, its trace silent (a heartbeat comes every 30 s:
 * two minutes without one is a computation stuck in a loop), incidents traced. A silent output says nothing: the
 * projects' measures write theirs at the end.
 */
export function warningsOf(job) {
  return [job.orphan ? "lanceur mort" : "", job.elapsedMin > job.limitMin * 0.9 ? `près de la limite (${job.limitMin} min)` : "", job.beatMin !== null && job.beatMin >= 2 ? `trace muette ${durationText(job.beatMin)}` : "", job.problems ? `${job.problems} incident${job.problems > 1 ? "s" : ""} tracé${job.problems > 1 ? "s" : ""}` : ""].filter(Boolean);
}

/** `mcts-backlog --list`: the machine, then the sections, aligned to `width`. */
export function listText(view, { color = false, width = 120, finished = 8 } = {}) {
  const s = stylesOf(color);
  const lines = [];
  const title = (text, n) => {
    lines.push("");
    lines.push(`${s.bold(text)} ${s.gray(`(${n})`)}`);
  };
  const idWidth = Math.min(46, Math.max(10, ...[...view.running, ...view.planned, ...view.blocked, ...view.waiting, ...view.finished.slice(0, finished)].map((job) => job.id.length)));
  const projectWidth = 9;
  lines.push(`${s.bold("La backlog de la machine")} ${s.gray(`— ${new Date(view.now).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}`)}`);
  lines.push(machineLine(view, s));
  const { doneToday, failedToday, nightEnd } = view.counts;
  lines.push(s.gray(`Aujourd'hui : ${doneToday} fini${doneToday > 1 ? "s" : ""}, ${failedToday} en échec${nightEnd ? ` · la file finirait vers ${clockText(nightEnd)} (${relativeText(nightEnd, view.now)})` : ""}`));

  title("En cours", view.running.length);
  for (const job of view.running) {
    const warnings = warningsOf(job);
    const head = `  ${s.cyan("▶")} ${fit(job.project, projectWidth)} ${fit(job.id, idWidth)} ${progressText(job, s)}`;
    lines.push(`${head}${warnings.length ? `  ${s.yellow(warnings.join(", "))}` : ""}`);
  }
  title("À venir", view.planned.length);
  for (const job of view.planned) {
    const tags = [job.priority !== 2 ? `priorité ${job.priority}` : "", job.threads > 1 ? `${job.threads} fils` : "", job.due ? `pour ${job.due}` : "", job.after.length ? `après ${job.after.join(", ")}` : ""].filter(Boolean).join(", ");
    const when = `${clockText(job.start)} ${s.gray(fit(relativeText(job.start, view.now), 14))}`;
    lines.push(`  ${when} ${fit(job.project, projectWidth)} ${fit(job.id, idWidth)} ${fit(durationText(job.estimateMin), 7, "right")}${job.late ? s.red("  en retard sur son échéance") : ""}${tags ? s.gray(`  ${tags}`) : ""}`);
  }
  if (view.waiting.length) {
    title("En attente", view.waiting.length);
    for (const job of view.waiting) lines.push(`  ${s.gray("◷")} ${fit(job.project, projectWidth)} ${fit(job.id, idWidth)} ${s.gray(job.reason)}`);
  }
  title("Bloqués", view.blocked.length);
  for (const job of view.blocked) lines.push(`  ${s.red("■")} ${fit(job.project, projectWidth)} ${fit(job.id, idWidth)} ${s.red(job.reason)}`);
  title("Derniers finis", Math.min(finished, view.finished.length));
  for (const job of view.finished.slice(0, finished)) {
    const status = statusOf(job.status);
    lines.push(`  ${s[status.color](status.icon)} ${fit(stampText(job.doneAt, view.now), 11)} ${fit(job.project, projectWidth)} ${fit(job.id, idWidth)} ${fit(durationText(job.minutes), 7, "right")} ${s.gray(`estimé ${durationText(job.estimateMin)}`)}${job.reason ? s.red(`  ${job.reason}`) : ""}`);
  }
  return lines.map((line) => (color ? line : line.slice(0, Math.max(width, 200)))).join("\n");
}

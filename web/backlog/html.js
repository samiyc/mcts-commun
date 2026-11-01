// The backlog page's bits of HTML (web/backlog.js): text escaped, a project's colour, a gauge, a badge, a table.

export const $ = (id) => document.getElementById(id);
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ENTITIES[char]);
export const decimal = (value) => String(value).replace(".", ",");

const PROJECTS = new Set(["cuisine", "entrepot", "urgences", "lopin"]);
/** The colour of a project's jobs, a CSS variable of backlog.css. */
export const projectColor = (name) => `var(--${PROJECTS.has(name) ? name : "other"})`;
export const project = (name) => `<span class="project" style="--project: ${projectColor(name)}">${escape(name)}</span>`;

/** "bad" from `bad` on, "warn" from `warn` on, else "". */
export function levelOf(value, bad, warn = Infinity) {
  if (value >= bad) return "bad";
  return value >= warn ? "warn" : "";
}

export const gauge = (fraction, level = "") => `<div class="gauge ${level}"><span style="width: ${Math.max(0, Math.min(100, fraction * 100)).toFixed(1)}%"></span></div>`;
export const badge = (text, level = "") => `<span class="badge ${level}">${escape(text)}</span>`;

/** A column title; ">" first aligns its numbers right. */
const headCell = (title) => (title.startsWith(">") ? `<th class="num">${escape(title.slice(1))}</th>` : `<th>${escape(title)}</th>`);

/** A table's head and rows, or a line saying it is `empty`. */
export function table(head, rows, empty) {
  if (!rows.length) return `<tbody><tr><td class="hint">${escape(empty)}</td></tr></tbody>`;
  return `<thead><tr>${head.map(headCell).join("")}</tr></thead><tbody>${rows.join("")}</tbody>`;
}

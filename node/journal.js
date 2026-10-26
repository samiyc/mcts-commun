import { appendFileSync, mkdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { tailOf } from "./tail.js";

/**
 * The runner's journal (Sami, 26/10/2026: the backlog was a black box): what `mcts-backlog` does, one JSON a line in
 * `<home>/journal/YYYY-MM.jsonl`, out of every repository. Written at once (a line a job or a guard: few), so that
 * the line before a crash is there.
 */
export function createJournal(home, { pid = process.pid } = {}) {
  const folder = path.join(home, "journal");
  return (kind, data = {}) => {
    const at = new Date();
    mkdirSync(folder, { recursive: true });
    appendFileSync(path.join(folder, `${at.toISOString().slice(0, 7)}.jsonl`), `${JSON.stringify({ at: at.toISOString(), pid, kind, ...data })}\n`);
  };
}

/** The journal's last `lines` entries, the oldest first; [] when there is none. */
export async function readJournal(home, lines = 200) {
  const folder = path.join(home, "journal");
  const months = (await readdir(folder).catch(() => [])).filter((name) => name.endsWith(".jsonl")).sort();
  const entries = [];
  for (const month of months.reverse()) {
    const tail = await tailOf(path.join(folder, month), { lines: lines - entries.length });
    entries.unshift(...tail.flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    }));
    if (entries.length >= lines) break;
  }
  return entries;
}

import { appendFileSync, mkdirSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
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

/**
 * When each of `pids` started as a runner, `{ pid: at }`, read from the whole journal, the latest month first: a runner's
 * start is soon past the last lines the views read (28/10/2026: "depuis 2 min" for a runner started 1 h 30 before).
 */
export async function runnerStarts(home, pids) {
  const folder = path.join(home, "journal");
  const months = (await readdir(folder).catch(() => [])).filter((name) => name.endsWith(".jsonl")).sort().reverse();
  const starts = {};
  for (const month of months) {
    if (pids.every((pid) => pid in starts)) break;
    const text = await readFile(path.join(folder, month), "utf8").catch(() => "");
    for (const line of text.split("\n").filter((one) => one.includes('"kind":"runner-started"'))) {
      const entry = JSON.parse(line);
      // The latest start of a pid wins: a pid may come back months later as another runner.
      if (pids.includes(entry.pid) && (starts[entry.pid] ?? "") <= entry.at) starts[entry.pid] = entry.at;
    }
  }
  return starts;
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

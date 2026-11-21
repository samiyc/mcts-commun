import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROJECTS, jobProjectOf } from "../board/board.js";
import { withLock } from "../machine.js";

/**
 * Sami's ranking of the projects (21/11/2026: « voyage en top 1, puis recrutement, puis codingame ; tout le reste
 * n'est pas prioritaire »): `<home>/ranking.json`, `{ projects, at, by }`. Strict: a job of a better-ranked project
 * goes first whatever the priorities (src/schedule.js `smithOrder`); the priority and Smith's rule decide within a
 * rank; a project out of the list comes after. The runner reads it at every pass, the views too; it is written by
 * `mcts-backlog --rank`, the TUI's P and the page, all through `setRanking`. docs/backlog.md, « Le classement ».
 */
const fileOf = (home) => path.join(home, "ranking.json");

/**
 * A runner started before this ranks nothing: it keeps the code it started with (docs/backlog.md, « Un lanceur
 * permanent »). The views say so while the permanent runner is older.
 */
export const RANKING_SINCE = "2026-11-21T11:53:00.000Z";

/** The ranking of `home`, `{ projects, at, by }`, or null: none, unreadable or empty. */
export async function readRanking(home) {
  try {
    const ranking = JSON.parse(await readFile(fileOf(home), "utf8"));
    return Array.isArray(ranking.projects) && ranking.projects.length > 0 ? ranking : null;
  } catch {
    return null;
  }
}

/** `projects` checked: names of the board's projects (node/board/board.js), each once, trimmed; throws otherwise. */
export function checkRanking(projects) {
  const names = projects.map((name) => String(name).trim().toLowerCase()).filter(Boolean);
  const unknown = names.filter((name) => !PROJECTS.includes(name));
  if (unknown.length) throw new Error(`projet inconnu : ${unknown.join(", ")} (${PROJECTS.join(", ")})`);
  const twice = names.filter((name, i) => names.indexOf(name) !== i);
  if (twice.length) throw new Error(`projet en double : ${[...new Set(twice)].join(", ")}`);
  return names;
}

/** Replaces `tmp` over `file`, a few tries: on Windows a file a view just read may refuse a moment (EPERM). */
async function replace(tmp, file) {
  for (let tries = 0; ; tries += 1) {
    const error = await rename(tmp, file).then(() => null, (failed) => failed);
    if (!error) return;
    if (error.code !== "EPERM" || tries >= 40) throw error;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Writes Sami's ranking (`projects`, the first is top 1; empty clears it), said by `by` ("commande", "tui", "page"), under
 * the queue's lock; journaled `ranking-set` when `journal` is given. Returns the ranking written, or null when cleared.
 */
export async function setRanking(home, projects, { by = "commande", journal = (_kind, _fields) => undefined } = {}) {
  const names = checkRanking(projects);
  const written = await withLock(home, async () => {
    if (names.length === 0) {
      await rm(fileOf(home), { force: true });
      return null;
    }
    const ranking = { projects: names, at: new Date().toISOString(), by };
    const tmp = `${fileOf(home)}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(ranking, null, 1)}\n`);
    await replace(tmp, fileOf(home));
    return ranking;
  }, "queue");
  journal("ranking-set", { projects: names, by });
  return written;
}

/** The jobs with the rank of their project (`rank`, 1 the first) when it is ranked; the others as they are. */
export function withRank(jobs, ranking) {
  const ranks = new Map((ranking?.projects ?? []).map((project, i) => [project, i + 1]));
  if (ranks.size === 0) return jobs;
  return jobs.map((job) => {
    const rank = ranks.get(jobProjectOf(job.cwd));
    return rank ? { ...job, rank } : job;
  });
}

/** The ranking as the views say it: « 1 voyage · 2 recrutement · 3 codingame », or null. */
export const rankingText = (ranking) => (ranking?.projects?.length ? ranking.projects.map((project, i) => `${i + 1} ${project}`).join(" · ") : null);

/** True when the permanent runner `stay` (`{ since }`) started before the ranking existed: it does not apply it. */
export const staleRunner = (stay) => Boolean(stay?.since) && stay.since < RANKING_SINCE;

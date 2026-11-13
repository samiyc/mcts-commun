import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { nextBatch, raceStep } from "../../src/race.js";
import { addJobs, jobStatus } from "../backlog/commands.js";

/**
 * The driver of a race (Sami, 12/11/2026): it sends each batch of seeds to the queue, one job a variant still in the
 * race, reads what they wrote, drops the variants the best beats (src/race.js), and sends the next batch. One call is
 * one step and can be run again at any time: the race's state lives in its folder, `<cwd>/races/<id>/race.json`, and
 * each job writes its seeds to `<variant>/<from>.jsonl` there, a line `{"seed": 12, "score": 1}` a seed.
 * The contract, for the projects: docs/course.md.
 */
const NAME = /^[\w.-]+$/;
const DEFAULTS = { cwd: ".", batch: 50, maxSeeds: 1000, minSeeds: 50, alpha: 0.05, maximize: true, firstSeed: 1, threads: 1, estimate: "15 min" };

/** The race a spec file describes, its defaults filled and its folders absolute; throws, saying why, on a bad one. */
export async function readSpec(file) {
  const spec = { ...DEFAULTS, ...JSON.parse(await readFile(file, "utf8")) };
  const names = [spec.id, ...(spec.variants ?? [])];
  if (!names.every((name) => typeof name === "string" && NAME.test(name))) throw new Error(`course ${file} : id et variants en lettres, chiffres, « . », « - » ou « _ »`);
  if (spec.variants.length < 2) throw new Error(`course ${spec.id} : il faut deux variantes au moins`);
  if (!["{variant}", "{from}", "{count}", "{out}"].every((key) => spec.command?.includes(key))) throw new Error(`course ${spec.id} : la commande prend {variant}, {from}, {count} et {out}`);
  const cwd = path.resolve(path.dirname(file), spec.cwd);
  return { ...spec, cwd, folder: path.join(cwd, "races", spec.id), looks: Math.ceil(spec.maxSeeds / spec.batch) };
}

const stateFile = (spec) => path.join(spec.folder, "race.json");

/** The race's state: its variants still in, those dropped and when, its rounds; a new race has all in, no round. */
export async function readState(spec) {
  try {
    return JSON.parse(await readFile(stateFile(spec), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { id: spec.id, alive: [...spec.variants], dropped: [], rounds: [] };
  }
}

/** variant → seed → score, from the `.jsonl` files of each variant of `variants`. */
export async function readResults(spec, variants) {
  /** @type {import("../../src/race.js").RaceResults} */
  const results = {};
  for (const variant of variants) {
    results[variant] = {};
    const folder = path.join(spec.folder, variant);
    const files = await readdir(folder).catch(() => []);
    for (const file of files.filter((name) => name.endsWith(".jsonl"))) Object.assign(results[variant], scoresOfFile(await readFile(path.join(folder, file), "utf8"), `${variant}/${file}`));
  }
  return results;
}

/** seed → score from a results file's lines; a line that is no `{ seed, score }` throws, with its place. */
function scoresOfFile(text, where) {
  const scores = {};
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    const { seed, score } = JSON.parse(line);
    if (!Number.isFinite(score) || seed === undefined) throw new Error(`${where}:${i + 1} : une ligne vaut {"seed": 12, "score": 1}`);
    scores[seed] = score;
  });
  return scores;
}

/** The job of `variant` for seeds `{ from, count }`: its id, its folder, its command with the placeholders filled. */
export function jobOf(spec, variant, { from, count }) {
  const out = path.relative(spec.cwd, path.join(spec.folder, variant, `${from}.jsonl`)).split(path.sep).join("/");
  const values = { variant, from: String(from), count: String(count), out };
  const command = spec.command.replace(/\{(variant|from|count|out)\}/g, (_, key) => values[key]);
  const job = { id: `race-${spec.id}-${variant}-${from}`, cwd: spec.cwd, command, estimate: spec.estimate, threads: spec.threads, status: "todo" };
  return spec.priority ? { ...job, priority: spec.priority } : job;
}

/** Job `id` as it stands, or its last retry (`mcts-backlog --retry` queues it again as `id-r1`, `id-r2`…). */
async function lastTry(queue, id, context) {
  let job = await jobStatus(queue, id, context);
  let n = 1;
  while (job?.finished && job.status !== "done") {
    const retry = await jobStatus(queue, `${id}-r${n}`, context);
    if (!retry) return job;
    job = retry;
    n += 1;
  }
  return job;
}

/** How the last round's jobs stand: "pending" while one has not ended, "failed" with the first that did not end done. */
async function roundOf(queue, round, context) {
  if (!round) return { state: "none" };
  const jobs = await Promise.all(round.jobs.map((id) => lastTry(queue, id, context)));
  const pending = jobs.filter((job) => job && !job.finished).map((job) => job.id);
  if (pending.length) return { state: "pending", pending };
  const at = jobs.findIndex((job) => !job || job.status !== "done");
  // The round's own id: a retry of it is named after it (id-r1, id-r2), never after a retry.
  return at < 0 ? { state: "ended" } : { state: "failed", job: round.jobs[at], status: jobs[at]?.status ?? "inconnu" };
}

/** The seeds the rounds have sent each variant still in the race. */
const playedOf = (state) => state.rounds.reduce((sum, round) => sum + round.count, 0);

/**
 * One step of the race described by `spec`, with the queue `queue` (`context`: the queue's `home` and thread
 * `budget`): what it did, `{ status, look, round }`. "waiting" while the last round runs, "failed" when one of its jobs
 * did not end done, else the variants are judged on every seed played and the next round goes to the queue
 * ("running"), unless one variant is left ("decided") or the budget of seeds is spent ("budget").
 */
export async function raceOnce(spec, queue, context) {
  const state = await readState(spec);
  const round = await roundOf(queue, state.rounds.at(-1), context);
  if (round.state === "pending") return { status: "waiting", state, pending: round.pending };
  if (round.state === "failed") return { status: "failed", state, job: round.job, jobStatus: round.status };
  const results = await readResults(spec, state.alive);
  const look = raceStep(results, state.alive, spec);
  const played = playedOf(state);
  if (look.seeds < played) throw new Error(`course ${spec.id} : ${look.seeds} graines lues en commun sur ${played} envoyées (une variante n'a pas tout écrit ?)`);
  state.alive = look.alive;
  state.dropped.push(...look.dropped.map((one) => ({ ...one, seeds: look.seeds })));
  const batch = state.alive.length > 1 ? nextBatch({ played, batch: spec.batch, maxSeeds: spec.maxSeeds, first: spec.firstSeed }) : null;
  if (batch) await sendRound(spec, queue, state, batch);
  await mkdir(spec.folder, { recursive: true });
  await writeFile(stateFile(spec), `${JSON.stringify({ ...state, look }, null, 2)}\n`);
  return { status: batch ? "running" : endOf(state), state, look, round: batch };
}

const endOf = (state) => (state.alive.length === 1 ? "decided" : "budget");

/** The jobs of a new round in the queue, one a variant still in, and the round in the state. */
async function sendRound(spec, queue, state, batch) {
  await Promise.all(state.alive.map((variant) => mkdir(path.join(spec.folder, variant), { recursive: true })));
  const jobs = state.alive.map((variant) => jobOf(spec, variant, batch));
  await addJobs(queue, jobs, " : la course a déjà envoyé ce lot");
  state.rounds.push({ ...batch, jobs: jobs.map((job) => job.id), at: new Date().toISOString() });
}

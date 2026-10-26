import { readFile } from "node:fs/promises";
import path from "node:path";
import { isFinished } from "../src/schedule.js";
import { projectNight, projectOf } from "./backlog-view.js";
import { stamp } from "./queue.js";

/**
 * What `mcts-backlog` does to the queue for a person or another tool (Sami, 26/10/2026: other applications must be
 * able to add jobs and follow them): add, look one up, wait for its end, cancel, retry. Every change goes through the
 * queue's lock (node/queue.js). The contract, for the tools: docs/backlog.md.
 */
const REQUIRED = ["id", "cwd", "command"];

/** Throws, naming what is missing, when `job` cannot go in the queue. */
function checkJob(job) {
  const missing = REQUIRED.filter((key) => typeof job[key] !== "string" || job[key].trim() === "");
  if (missing.length) throw new Error(`job ${job.id ?? "?"} incomplet : ${missing.join(", ")}`);
}

/** Adds `jobs` at the end of the queue, every id new (the queue's and the archive's); `hint` follows a refusal. */
export function addJobs(queue, jobs, hint = "") {
  jobs.forEach(checkJob);
  return queue.change(async (current) => {
    const taken = new Set([...current.jobs, ...(await queue.readArchive())].map((job) => job.id));
    const twice = firstTwice(jobs, taken);
    if (twice) throw new Error(`le job ${twice.id} existe déjà${hint}`);
    current.jobs.push(...jobs);
  });
}

/** The first of `jobs` whose id is `taken` or comes twice among them. */
function firstTwice(jobs, taken) {
  const seen = new Set(taken);
  for (const job of jobs) {
    if (seen.has(job.id)) return job;
    seen.add(job.id);
  }
  return undefined;
}

/** The jobs of a project's night file, each id (and its `after`) tagged, run in the file's folder. */
export async function jobsOfFile(file, tag, extra = {}) {
  const { jobs } = JSON.parse(await readFile(file, "utf8"));
  const tagged = (id) => `${id}-${tag}`;
  return jobs.map((job) => ({ status: "todo", estimate: "1 h", ...job, ...extra, id: tagged(job.id), cwd: path.dirname(file), ...(job.after ? { after: job.after.map(tagged) } : {}) }));
}

/** Where a job stands, read from the queue or the archive: null for an id never seen. */
export async function jobStatus(queue, id, { home, budget, now = Date.now() }) {
  const current = await queue.read();
  const archive = await queue.readArchive();
  const queued = current.jobs.find((job) => job.id === id);
  const job = queued ?? archive.filter((one) => one.id === id).at(-1);
  if (!job) return null;
  const night = queued && !isFinished(queued) ? planOf(projectNight(current.jobs, archive, budget, now), id) : {};
  const full = (file) => (file ? path.join(home, file) : null);
  return { ...job, project: projectOf(job.cwd), place: queued ? "queue" : "archive", finished: isFinished(job), ...night, output: full(job.output), trace: full(job.trace) };
}

/** When the night to come starts job `id`, or why it waits. */
function planOf({ order, waiting }, id) {
  const planned = order.find((one) => one.job.id === id);
  if (planned) return { plannedStart: new Date(planned.start).toISOString(), plannedEnd: new Date(planned.end).toISOString() };
  const held = waiting.find((one) => one.job.id === id);
  return held ? { waiting: held.reason, blocked: Boolean(held.blocked) } : {};
}

/** The exit code of `--wait`: 0 done, 1 failed or too long, 2 cancelled or skipped, 3 unknown, 4 still running. */
export function waitCode(job) {
  if (!job) return 3;
  if (!job.finished) return 4;
  if (job.status === "done") return 0;
  return ["failed", "timeout"].includes(job.status) ? 1 : 2;
}

/**
 * Polls job `id` every `everyMs` until it ends or `minutes` pass: its last status (null when unknown).
 *
 * @param {ReturnType<typeof import("./queue.js").createQueue>} queue
 * @param {string} id
 * @param {{ home: string, budget: number, minutes?: number, everyMs?: number }} options
 */
export async function waitFor(queue, id, { minutes = Infinity, everyMs = 2_000, ...context }) {
  const until = Date.now() + minutes * 60_000;
  for (;;) {
    const job = await jobStatus(queue, id, context);
    if (!job || job.finished || Date.now() >= until) return job;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

const CANCELLED = "annulé (mcts-backlog --cancel)";

/**
 * Cancels job `id`: one to come ends cancelled at once (the jobs after it are then blocked); a running one is marked
 * for its runner, which stops it (a runner started before 26/10 does not know the mark). What was done.
 */
export async function cancelJob(queue, id) {
  const done = await queue.change((current) => {
    const job = current.jobs.find((one) => one.id === id);
    if (!job || isFinished(job)) return { keep: true, done: job ? "already" : "unknown" };
    if (job.status === "running") Object.assign(job, { cancel: true });
    else Object.assign(job, { status: "cancelled", doneAt: stamp(), minutes: 0, reason: CANCELLED });
    return { done: job.status === "running" ? "marked" : "cancelled" };
  });
  if (done.done === "cancelled") await queue.archiveFinished();
  return done.done;
}

/** What a retry keeps of a job: what it runs and how; not its end, nor prerequisites long over, nor a due passed. */
const KEPT = ["cwd", "command", "estimate", "threads", "priority", "limit", "skipIf", "machine", "returns"];

/** Queues a finished job again under a new id (`<id>-r1`, `-r2`…): the new job. */
export async function retryJob(queue, id) {
  const archive = await queue.readArchive();
  const current = await queue.read();
  const last = [...archive, ...current.jobs].filter((job) => job.id === id).at(-1);
  if (!last) throw new Error(`job inconnu : ${id}`);
  if (!isFinished(last)) throw new Error(`le job ${id} n'est pas fini (${last.status})`);
  const tries = [...archive, ...current.jobs].filter((job) => job.id.startsWith(`${id}-r`)).length;
  const again = { id: `${id}-r${tries + 1}`, status: "todo", retryOf: id, ...Object.fromEntries(KEPT.filter((key) => last[key] !== undefined).map((key) => [key, last[key]])) };
  await addJobs(queue, [again]);
  return again;
}

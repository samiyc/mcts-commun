import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isFinished } from "../src/schedule.js";
import { stamp } from "./queue.js";
import { transportOf } from "./remote-transport.js";

/**
 * The queue on another machine (Sami, 26/10/2026: the PC's 18 threads may not be enough for every project; lopin's
 * laptop queue, made a queue for any machine). A job may say `machine: "cloud"`: the local runner leaves it, and
 *
 *   --push cloud    sends mcts-commun and the folders of its jobs (node_modules, .git, logs, tmp left out), links
 *                   each project to the mcts-commun beside it, adds the jobs to the machine's own queue
 *                   (`<dir>/home`), its paths rewritten, and starts a runner there
 *   --list --machine cloud   the machine's queue, as `--list` shows this one's (`--json` too)
 *   --pull cloud    brings back its runs, traces, journal and finished jobs (to `machines/cloud/` here), ends the
 *                   jobs sent with what they did, and copies back the files each job names in `returns` (paths of
 *                   its project, to read with `git diff` before any commit)
 *
 * The machines are in `<home>/machines.json`, on this PC only (node/remote-transport.js says how each is reached).
 */
const COMMUN = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const REMOTE_HOME = "home";
const REMOTE_BACKLOG = `node mcts-commun/bin/backlog.js --home ${REMOTE_HOME}`;
const ENDED = ["status", "startedAt", "doneAt", "minutes", "reason"];

/** Machine `name` of `<home>/machines.json`, with its transport. */
export async function machineOf(home, name) {
  const machines = JSON.parse(await readFile(path.join(home, "machines.json"), "utf8").catch(() => "{}"));
  if (!machines[name]) throw new Error(`machine inconnue : ${name} (${path.join(home, "machines.json")})`);
  return { ...machines[name], name, transport: transportOf(machines[name], name) };
}

/** The jobs of the local queue for machine `name` not sent yet. */
const toSend = (jobs, name) => jobs.filter((job) => job.machine === name && ["todo", "scheduled"].includes(job.status) && !job.sentAt);

/** A job as the other machine's queue takes it: its folder beside the outbox, the local marks left out. */
function remoteJob(job) {
  const copy = { ...job, cwd: `../${path.basename(job.cwd)}` };
  delete copy.machine;
  delete copy.sentAt;
  return copy;
}

/** mcts-commun and the folders of `jobs`, sent; each project linked to the mcts-commun beside it. */
async function sendFolders(transport, jobs) {
  await transport.send(COMMUN, "mcts-commun");
  for (const project of new Set(jobs.map((job) => job.cwd))) {
    await transport.send(project, path.basename(project));
    await transport.link(path.basename(project));
  }
}

/** The jobs written to this machine's outbox for machine `name`, then sent: the file's name. */
async function sendOutbox({ home, name, transport }, jobs) {
  const outbox = path.join(home, "machines", name, "outbox");
  await mkdir(outbox, { recursive: true });
  const file = `jobs-${stamp().replace(/[:T]/g, "-")}.json`;
  await writeFile(path.join(outbox, file), JSON.stringify({ jobs: jobs.map(remoteJob) }, null, 2));
  await transport.send(outbox, "outbox");
  return file;
}

/** Sends machine `name` its jobs and starts its runner: the ids sent. */
export async function pushJobs({ home, queue, name, journal }) {
  const machine = await machineOf(home, name);
  const jobs = toSend((await queue.read()).jobs, name);
  if (jobs.length === 0) return [];
  const { transport } = machine;
  await sendFolders(transport, jobs);
  const file = await sendOutbox({ home, name, transport }, jobs);
  const added = await transport.run(`${REMOTE_BACKLOG} --add-file outbox/${file} --no-tag`);
  if (added.code !== 0) throw new Error(`la file de ${name} a refusé ces jobs : ${added.stderr.trim() || added.stdout.trim()}`);
  const budget = machine.budget ? ` --budget ${Number(machine.budget)}` : "";
  await transport.start(`${REMOTE_BACKLOG}${budget} > ${REMOTE_HOME}/runner-${file.slice(5, -5)}.log 2>&1`);
  const ids = jobs.map((job) => job.id);
  await queue.change((current) => {
    for (const job of current.jobs.filter((one) => ids.includes(one.id))) job.sentAt = stamp();
  });
  journal("pushed", { machine: name, ids, to: transport.describe });
  return ids;
}

/** The other machine's view, as `--json` gives it there. */
export async function remoteView({ home, name }) {
  const { transport } = await machineOf(home, name);
  const result = await transport.run(`${REMOTE_BACKLOG} --json`);
  if (result.code !== 0) throw new Error(`${name} ne répond pas : ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

/** The finished jobs of the copy of the other machine's archive. */
async function archiveOf(folder) {
  const done = path.join(folder, REMOTE_HOME, "done");
  const names = (await readdir(done).catch(() => [])).filter((one) => one.endsWith(".json"));
  return (await Promise.all(names.map(async (one) => JSON.parse(await readFile(path.join(done, one), "utf8"))))).flat();
}

/** A job sent, ended with what it did there: its end, its output and trace in the copy brought back. */
function endedFrom(remote, { home, folder }) {
  const local = (file) => (file ? path.relative(home, path.join(folder, REMOTE_HOME, file)) : undefined);
  const ended = Object.fromEntries(ENDED.filter((key) => remote[key] !== undefined).map((key) => [key, remote[key]]));
  return { ...ended, output: local(remote.output), trace: local(remote.trace), pulledAt: stamp() };
}

/** Brings back what machine `name` did: `{ ended: ids, waiting: ids still there }`. */
export async function pullJobs({ home, queue, name, journal }) {
  const { transport } = await machineOf(home, name);
  const folder = path.join(home, "machines", name);
  for (const part of ["done", "runs", "traces", "journal"]) await transport.fetch(`${REMOTE_HOME}/${part}`, folder);
  const finished = new Map((await archiveOf(folder)).filter(isFinished).map((job) => [job.id, job]));
  const sent = (await queue.read()).jobs.filter((job) => job.machine === name && job.sentAt);
  const ended = sent.filter((job) => finished.has(job.id));
  for (const job of ended) {
    for (const file of job.returns ?? []) await transport.fetch(`${path.basename(job.cwd)}/${file}`, path.dirname(job.cwd));
  }
  const endedIds = new Set(ended.map((job) => job.id));
  await queue.change((current) => {
    for (const job of current.jobs.filter((one) => endedIds.has(one.id))) Object.assign(job, endedFrom(finished.get(job.id), { home, folder }));
  });
  await queue.archiveFinished();
  const ids = ended.map((job) => job.id);
  journal("pulled", { machine: name, ids });
  return { ended: ids, waiting: sent.filter((job) => !finished.has(job.id)).map((job) => job.id) };
}

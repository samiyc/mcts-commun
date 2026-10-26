#!/usr/bin/env node
import path from "node:path";
import { addJobs, cancelJob, jobStatus, jobsOfFile, retryJob, waitCode, waitFor } from "../node/backlog-commands.js";
import { colorsOn, listText, paren } from "../node/backlog-text.js";
import { readBacklog, viewOf } from "../node/backlog-view.js";
import { createJournal } from "../node/journal.js";
import { backlogHome, threadBudget } from "../node/machine.js";
import { createQueue, stamp } from "../node/queue.js";
import { runQueue } from "../node/runner.js";

/**
 * `mcts-backlog`: the machine's long jobs, every project's (Sami, 23/10/2026: the scheduler in common, so that the
 * hospital, the warehouse and the kitchen run their night measures too). One queue for the machine,
 * `~/.mcts-backlog/queue.json` (`MCTS_BACKLOG_HOME` or `--home` elsewhere); each job says the folder it runs in.
 *
 *   mcts-backlog                 run the queue to its end (node/runner.js)
 *   mcts-backlog --list [--done N]  the machine, the jobs running, the night to come as the runner would play it,
 *                                what is blocked and why, the last N done (8); --json, the same as JSON
 *   mcts-backlog --tui           the same in a terminal view that follows it live (node/tui.js), read only
 *   mcts-backlog --add ID --cwd DIR [--estimate "40 min"] [--threads N] [--priority 1|2|3] [--after A,B]
 *                [--due 2026-10-24T08:00] [--limit MIN] [--skip-if "COMMAND"] -- COMMAND…
 *   mcts-backlog --add-file PROJECT/night.json [--tag 2026-10-24]
 *                every job of a project's file (`{ jobs: [{ id, command, estimate, … }] }`), run in the file's folder;
 *                each id (and its `after`) gets the tag, today's date by default, so the file can be queued again
 *                the next night.
 *   mcts-backlog --status ID [--json]        where a job stands: to come (when), running, ended (how), its files
 *   mcts-backlog --wait ID [--timeout MIN]   waits for its end; exit 0 done, 1 failed or too long, 2 cancelled or
 *                                            skipped, 3 unknown, 4 still running at the timeout
 *   mcts-backlog --cancel ID                 a job to come ends cancelled; a running one is stopped by its runner
 *   mcts-backlog --retry ID                  a finished job queued again, as ID-r1
 *
 * For other tools (Sami, 26/10/2026), the contract is docs/backlog.md: these commands, their JSON and exit codes;
 * every change holds the queue's lock (node/queue.js), so a tool never loses the runner's writes nor the runner its.
 */
const args = process.argv.slice(2);
const option = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const home = path.resolve(option("--home", backlogHome()));
const budget = Number(option("--budget", threadBudget()));
const journal = createJournal(home);
const queue = createQueue(home, { journal });

const tags = (job) => [job.threads > 1 ? `${job.threads} fils` : "", job.priority && job.priority !== 2 ? `priorité ${job.priority}` : "", job.due ? `pour ${job.due}` : "", job.after?.length ? `après ${job.after.join(", ")}` : ""].filter(Boolean).join(", ");
const lineOf = (job) => [`[${job.status}] ${job.id} — ${job.estimate ?? "?"} — ${job.cwd} : ${job.command}`, tags(job) && ` (${tags(job)})`].filter(Boolean).join("");

/** The job `--add` describes, from its options and the command after `--`. */
function jobOfOptions() {
  const id = option("--add");
  const at = args.indexOf("--");
  if (!id || at < 0 || !option("--cwd")) {
    console.error('usage : mcts-backlog --add ID --cwd DOSSIER [--estimate "40 min"] [--threads N] [--priority 2] [--after A,B] [--due ISO] [--limit MIN] [--skip-if "COMMANDE"] -- COMMANDE…');
    process.exit(1);
  }
  const job = { id, cwd: path.resolve(option("--cwd")), command: args.slice(at + 1).join(" "), estimate: option("--estimate", "1 h"), status: "todo" };
  /** @type {Record<string, [string, (text: string) => any]>} */
  const read = { "--threads": ["threads", Number], "--priority": ["priority", Number], "--limit": ["limit", Number], "--due": ["due", String], "--after": ["after", (text) => text.split(",")], "--skip-if": ["skipIf", String] };
  for (const [flag, [key, parse]] of Object.entries(read)) if (option(flag) !== null) job[key] = parse(option(flag));
  return job;
}

async function add() {
  const job = jobOfOptions();
  await addJobs(queue, [job]);
  journal("added", { ids: [job.id] });
  console.log(`Ajouté : ${lineOf(job)}`);
}

async function addFile() {
  const file = path.resolve(option("--add-file"));
  const added = await jobsOfFile(file, option("--tag", stamp().slice(0, 10)));
  await addJobs(queue, added, " : --tag pour une autre série");
  journal("added", { ids: added.map((job) => job.id), file });
  for (const job of added) console.log(`Ajouté : ${lineOf(job)}`);
}

/** What the runner holds, read without writing (Sami, 26/10/2026: --list was obscure; the backlog a black box). */
async function list() {
  const view = viewOf(await readBacklog(home, { budget }));
  if (args.includes("--json")) console.log(JSON.stringify(view, null, 1));
  else console.log(listText(view, { color: colorsOn(), width: process.stdout.columns ?? 120, finished: Number(option("--done", 8)) }));
}

const statusText = (job) => [`${job.id} : ${job.status}${paren(job.reason)}`, job.plannedStart && `prévu ${job.plannedStart}`, job.waiting && `attend : ${job.waiting}`, job.output && `sortie ${job.output}`].filter(Boolean).join(" · ");

async function status() {
  const job = await jobStatus(queue, option("--status"), { home, budget });
  if (args.includes("--json")) console.log(JSON.stringify(job));
  else console.log(job ? statusText(job) : `job inconnu : ${option("--status")}`);
  return job ? 0 : 3;
}

async function wait() {
  const minutes = Number(option("--timeout", Infinity));
  const job = await waitFor(queue, option("--wait"), { home, budget, minutes, everyMs: Number(process.env.MCTS_BACKLOG_POLL_MS || 2_000) });
  console.log(args.includes("--json") ? JSON.stringify(job) : (job && statusText(job)) || `job inconnu : ${option("--wait")}`);
  return waitCode(job);
}

const SAID = { cancelled: "annulé", marked: "marqué : son lanceur l'arrête", already: "déjà fini", unknown: "inconnu" };
async function cancel() {
  const done = await cancelJob(queue, option("--cancel"));
  if (done !== "unknown" && done !== "already") journal("cancel-asked", { id: option("--cancel"), done });
  console.log(`${option("--cancel")} : ${SAID[done]}`);
  return done === "unknown" ? 3 : 0;
}

async function retry() {
  const job = await retryJob(queue, option("--retry"));
  journal("added", { ids: [job.id], retryOf: option("--retry") });
  console.log(`Ajouté : ${lineOf(job)}`);
}

async function tui() {
  const { runTui } = await import("../node/tui.js");
  await runTui({ home, budget });
}

const COMMANDS = { "--add": add, "--add-file": addFile, "--list": list, "--json": list, "--tui": tui, "--status": status, "--wait": wait, "--cancel": cancel, "--retry": retry };
const asked = Object.keys(COMMANDS).find((flag) => args.includes(flag) && !(flag === "--json" && (args.includes("--status") || args.includes("--wait"))));
if (asked) process.exit((await COMMANDS[asked]()) ?? 0);
await runQueue({ home, budget, queue, journal, pollMs: Number(process.env.MCTS_BACKLOG_POLL_MS || 5_000) });

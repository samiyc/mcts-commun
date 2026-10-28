#!/usr/bin/env node
import path from "node:path";
import { addJobs, cancelJob, commandOf, jobStatus, jobsOfFile, retryJob, setPriority, waitCode, waitFor } from "../node/backlog-commands.js";
import { colorsOn, listText, paren } from "../node/backlog-text.js";
import { readBacklog, viewOf } from "../node/backlog-view.js";
import { createJournal } from "../node/journal.js";
import { backlogHome, threadBudget } from "../node/machine.js";
import { createQueue, stamp } from "../node/queue.js";
import { pullJobs, pushJobs, remoteView } from "../node/remote.js";
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
 *   mcts-backlog --add ID --cwd DIR [--estimate "40 min"] [--measured] [--threads N] [--priority 1|2|3] [--after A,B]
 *                [--due 2026-10-24T08:00] [--limit MIN] [--skip-if "COMMAND"] -- COMMAND…
 *                --measured: the estimate comes from a measure of today's code, the queue keeps it as it is
 *   mcts-backlog --add-file PROJECT/night.json [--tag 2026-10-24 | --no-tag] [--measured]
 *                every job of a project's file (`{ jobs: [{ id, command, estimate, … }] }`), run in its `cwd` (the
 *                file's folder by default); each id (and its `after`) gets the tag, today's date by default, so the
 *                file can be queued again the next night; --no-tag keeps the ids as they are.
 *   mcts-backlog --status ID [--json]        where a job stands: to come (when), running, ended (how), its files
 *   mcts-backlog --wait ID [--timeout MIN]   waits for its end; exit 0 done, 1 failed or too long, 2 cancelled or
 *                                            skipped, 3 unknown, 4 still running at the timeout
 *   mcts-backlog --cancel ID                 a job to come ends cancelled; a running one is stopped by its runner
 *   mcts-backlog --retry ID [--priority N]   a finished job queued again, as ID-r1 (at priority N)
 *   mcts-backlog --set-priority PATTERN N    the jobs to come whose id matches (`*` any characters) at priority N
 *   mcts-backlog --push MACHINE              the jobs for another machine (`--machine MACHINE` on --add or --add-file)
 *                                            sent there with their folders, its runner started (node/remote.js)
 *   mcts-backlog --list --machine MACHINE    its queue (--json too); --pull MACHINE brings back what it did
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
  const job = { id, cwd: path.resolve(option("--cwd")), command: commandOf(args.slice(at + 1)), estimate: option("--estimate", "1 h"), status: "todo", ...measured() };
  /** @type {Record<string, [string, (text: string) => any]>} */
  const read = { "--threads": ["threads", Number], "--priority": ["priority", Number], "--limit": ["limit", Number], "--due": ["due", String], "--after": ["after", (text) => text.split(",")], "--skip-if": ["skipIf", String], "--machine": ["machine", String] };
  for (const [flag, [key, parse]] of Object.entries(read)) if (option(flag) !== null) job[key] = parse(option(flag));
  return job;
}

/** `--measured`: the estimates come from a measure of today's code, kept as they are (src/estimate.js). */
const measured = () => (args.includes("--measured") ? { measured: true } : {});

async function add() {
  const job = jobOfOptions();
  await addJobs(queue, [job]);
  journal("added", { ids: [job.id] });
  console.log(`Ajouté : ${lineOf(job)}`);
}

async function addFile() {
  const file = path.resolve(option("--add-file"));
  const extra = { ...(option("--machine") ? { machine: option("--machine") } : {}), ...measured() };
  const added = await jobsOfFile(file, args.includes("--no-tag") ? null : option("--tag", stamp().slice(0, 10)), extra);
  await addJobs(queue, added, " : --tag pour une autre série");
  journal("added", { ids: added.map((job) => job.id), file });
  for (const job of added) console.log(`Ajouté : ${lineOf(job)}`);
}

/** What the runner holds, read without writing (Sami, 26/10/2026: --list was obscure; the backlog a black box). */
async function list() {
  const machine = option("--machine");
  const view = machine ? await remoteView({ home, name: machine }) : viewOf(await readBacklog(home, { budget }));
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
  const job = await retryJob(queue, option("--retry"), option("--priority") ? { priority: Number(option("--priority")) } : {});
  journal("added", { ids: [job.id], retryOf: option("--retry") });
  console.log(`Ajouté : ${lineOf(job)}`);
}

async function priority() {
  const [pattern, value] = [option("--set-priority"), Number(args[args.indexOf("--set-priority") + 2])];
  const ids = await setPriority(queue, pattern, value);
  if (ids.length) journal("priority-set", { ids, priority: value });
  console.log(ids.length ? `Priorité ${value} : ${ids.join(", ")}` : `Aucun job à venir ne correspond à ${pattern}`);
  return ids.length ? 0 : 3;
}

async function tui() {
  const { runTui } = await import("../node/tui.js");
  await runTui({ home, budget });
}

/** `--slot N [--id NOM] -- COMMANDE`: the command run in N of the machine's threads, once free (node/slot-run.js). */
async function slot() {
  const at = args.indexOf("--");
  const threads = Number(option("--slot"));
  if (at < 0 || !Number.isInteger(threads) || threads < 1) {
    console.error("usage : mcts-backlog --slot N [--id NOM] -- COMMANDE   (N fils pris dans les créneaux de la machine)");
    return 1;
  }
  const command = commandOf(args.slice(at + 1));
  const { runInSlot } = await import("../node/slot-run.js");
  return runInSlot({ home, budget, threads, id: option("--id", `session:${path.basename(process.cwd())}:${command.slice(0, 40)}`), command });
}

async function push() {
  const ids = await pushJobs({ home, queue, name: option("--push"), journal });
  console.log(ids.length ? `Envoyé à ${option("--push")} : ${ids.join(", ")}` : `Rien à envoyer à ${option("--push")} (des jobs avec --machine ${option("--push")}).`);
}

async function pull() {
  const { ended, waiting } = await pullJobs({ home, queue, name: option("--pull"), journal });
  console.log(`${option("--pull")} : ${ended.length} fini(s) rapatrié(s)${ended.length ? " (" + ended.join(", ") + ")" : ""}, ${waiting.length} encore là-bas.`);
}

const COMMANDS = { "--push": push, "--pull": pull, "--add": add, "--add-file": addFile, "--list": list, "--json": list, "--tui": tui, "--status": status, "--wait": wait, "--cancel": cancel, "--retry": retry, "--set-priority": priority, "--slot": slot };
const OPTIONS = ["--home", "--budget", "--done", "--tag", "--no-tag", "--cwd", "--estimate", "--threads", "--priority", "--after", "--due", "--limit", "--skip-if", "--machine", "--timeout", "--id", "--measured"];
const USAGE = `mcts-backlog : la file de la machine (docs/backlog.md)
  mcts-backlog                       lance la file jusqu'au bout
  --list [--done N] [--json] | --tui la file, en texte, en JSON ou en direct
  --add ID --cwd DOSSIER [--estimate "40 min"] [--measured] [--threads N] [--priority 1|2|3] [--after A,B] [--due ISO] [--limit MIN] [--skip-if "COMMANDE"] [--machine M] -- COMMANDE…
  --add-file FICHIER.json [--tag T | --no-tag] [--machine M] [--measured]
  --status ID [--json] · --wait ID [--timeout MIN] · --cancel ID · --retry ID [--priority N]
  --set-priority MOTIF N             les jobs à venir dont l'id correspond (* : n'importe quoi) en priorité N
  --slot N [--id NOM] -- COMMANDE    un test court hors file (4 fils, 15 min au plus), dans N fils libres ; la
                                     commande passe par le shell du système (cmd.exe sous Windows, comme les jobs)
  --push M · --pull M · --list --machine M
  options : --home DOSSIER, --budget FILS`;

// An option it does not know never starts a runner (27/10/2026: --help started one on the machine's queue).
const words = args.includes("--") ? args.slice(0, args.indexOf("--")) : args;
const unknown = words.filter((word) => word.startsWith("-") && !(word in COMMANDS) && !OPTIONS.includes(word));
if (unknown.length) {
  const help = unknown.every((word) => ["--help", "-h"].includes(word));
  (help ? console.log : console.error)(help ? USAGE : `option inconnue : ${unknown.join(", ")}

${USAGE}`);
  process.exit(help ? 0 : 1);
}
const asked = Object.keys(COMMANDS).find((flag) => args.includes(flag) && !(flag === "--json" && (args.includes("--status") || args.includes("--wait"))));
if (asked) process.exit((await COMMANDS[asked]()) ?? 0);
await runQueue({ home, budget, queue, journal, pollMs: Number(process.env.MCTS_BACKLOG_POLL_MS || 5_000) });

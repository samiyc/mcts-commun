#!/usr/bin/env node
import path from "node:path";
import { waitFor } from "../node/backlog/commands.js";
import { backlogHome, threadBudget } from "../node/machine.js";
import { createJournal } from "../node/queue/journal.js";
import { createQueue } from "../node/queue/queue.js";
import { raceOnce, readSpec } from "../node/race/race.js";

/**
 * `mcts-race`: a race of configurations through the queue (Sami, 12/11/2026; src/race.js, node/race/race.js).
 *
 *   mcts-race SPEC.json            one step: judges the seeds played, drops the beaten variants, sends the next batch
 *   mcts-race SPEC.json --follow   steps until the race ends, waiting for each batch's jobs
 *   options: --home DIR (the queue's), --json (the step as JSON)
 *
 * Exit 0 when the race goes on or has ended, 1 when a job of the last batch did not end done. docs/course.md.
 */
const args = process.argv.slice(2);
const option = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const file = args.find((arg) => arg.endsWith(".json") && arg !== option("--home"));
if (!file) {
  console.error("usage : mcts-race COURSE.json [--follow] [--home DOSSIER] [--json]");
  process.exit(2);
}
const home = path.resolve(option("--home", backlogHome()));
const context = { home, budget: threadBudget() };
const queue = createQueue(home, { journal: createJournal(home) });

const decimal = (value) => value.toFixed(3).replace(".", ",");
const gapText = ({ gap }) => `écart ${decimal(gap.mean)} [${decimal(gap.low)} ; ${decimal(gap.high)}]`;

/** The variants still in by their means, then those dropped, when and by how much. */
function standingsText(state, look) {
  const kept = (look?.standings ?? []).filter(({ variant }) => state.alive.includes(variant));
  const lines = kept.map(({ variant, mean }, i) => `  ${i + 1}. ${variant.padEnd(20)} ${decimal(mean)}`);
  return [...lines, ...state.dropped.map((one) => `  ✗  ${one.variant.padEnd(20)} ${decimal(one.mean)}  écartée à ${one.seeds} graines (${gapText(one)})`)];
}

/** The race as a person reads it: its seeds, the variants still in by their means, those dropped, what comes. */
function stepText(spec, step) {
  const { state, round } = step;
  const look = step.look ?? state.look;
  const lines = [`Course ${spec.id} : ${look?.seeds ?? 0} graines sur ${spec.maxSeeds}, ${state.alive.length} variante(s) en course — ${step.status}`, ...standingsText(state, look)];
  if (round) lines.push(`Lot suivant : graines ${round.from} à ${round.from + round.count - 1}, ${state.alive.length} jobs`);
  if (step.pending) lines.push(`En attente : ${step.pending.join(", ")}`);
  if (step.job) lines.push(`Le job ${step.job} a fini ${step.jobStatus} : la course s'arrête (mcts-backlog --retry ${step.job}, puis relancer la course)`);
  return lines.join("\n");
}

async function main() {
  const spec = await readSpec(path.resolve(file));
  for (;;) {
    const step = await raceOnce(spec, queue, context);
    console.log(args.includes("--json") ? JSON.stringify(step) : stepText(spec, step));
    if (step.status === "failed") return 1;
    if (!args.includes("--follow") || ["decided", "budget"].includes(step.status)) return 0;
    for (const id of step.pending ?? step.state.rounds.at(-1).jobs) await waitFor(queue, id, { ...context, everyMs: 30_000 });
  }
}

process.exitCode = await main();

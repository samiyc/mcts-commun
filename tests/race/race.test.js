import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jobOf, readSpec } from "../../node/race/race.js";
import { archiveOf, backlog, quiet, run, scratch } from "../fixtures/backlog-cli.js";

/**
 * A race through a queue of its own (bin/race.js, node/race/race.js, docs/course.md; Sami, 12/11/2026): each step sends
 * a batch to the queue, the runner plays it, the next step judges it. Never the machine's own `~/.mcts-backlog`.
 */
const RACE = fileURLToPath(new URL("../../bin/race.js", import.meta.url));
const race = (home, spec, ...args) => run(process.execPath, [RACE, spec, "--home", home, ...args], { env: quiet });
const raceCode = (home, spec) => race(home, spec).then(() => 0, (error) => error.code);

// A game per seed: won with the variant's rate, the same draw for every variant on a seed (paired seeds).
const PLAY = `import { appendFileSync } from "node:fs";
const [variant, from, count, out] = process.argv.slice(2);
const rate = { good: 0.75, twin: 0.75, bad: 0.15, broken: 0.5 }[variant];
if (variant === "broken") process.exit(1);
for (let seed = Number(from); seed < Number(from) + Number(count); seed += 1) {
  const draw = ((seed * 2654435761) % 4294967296) / 4294967296;
  appendFileSync(out, JSON.stringify({ seed, score: draw < rate ? 1 : 0 }) + "\\n");
}
`;

async function project(folder, variants, extra = {}) {
  await writeFile(path.join(folder, "play.mjs"), PLAY);
  const spec = { id: "essai", command: "node play.mjs {variant} {from} {count} {out}", variants, batch: 20, maxSeeds: 100, minSeeds: 20, estimate: "1 min", ...extra };
  const file = path.join(folder, "course.json");
  await writeFile(file, JSON.stringify(spec));
  return file;
}

describe("a race through the queue (bin/race.js, node/race/race.js)", () => {
  it("sends a batch a step, drops the beaten variant, and plays two it cannot tell apart to the budget", () =>
    scratch(async (home, folder) => {
      const spec = await project(folder, ["good", "twin", "bad"]);
      const first = await race(home, spec);
      assert.match(first.stdout, /Lot suivant : graines 1 à 20, 3 jobs/);
      assert.match((await race(home, spec)).stdout, /— waiting/, "the batch has not run");
      let text = "";
      for (let step = 0; step < 6 && !/— (decided|budget)/.test(text); step += 1) {
        await backlog(home, "--budget", "3");
        text = (await race(home, spec)).stdout;
      }
      assert.match(text, /— budget/, text);
      assert.match(text, /✗ {2}bad/);
      const state = JSON.parse(await readFile(path.join(folder, "races", "essai", "race.json"), "utf8"));
      assert.deepEqual(state.alive, ["good", "twin"]);
      assert.equal(state.dropped[0].seeds, 20, "dropped at the first look");
      assert.deepEqual(state.rounds.map((round) => round.from), [1, 21, 41, 61, 81]);
      const archive = await archiveOf(home);
      assert.equal(archive.length, 3 + 4 * 2, "bad played one batch, the others five");
    }));

  it("stops on a job that failed, until it is retried", () =>
    scratch(async (home, folder) => {
      const spec = await project(folder, ["good", "broken"]);
      await race(home, spec);
      await backlog(home);
      assert.equal(await raceCode(home, spec), 1);
      const { stdout } = await race(home, spec, "--json").catch((error) => error);
      assert.equal(JSON.parse(stdout).job, "race-essai-broken-1");
      // Retried, it fails again: the race still names the round's job, the one to retry.
      await backlog(home, "--retry", "race-essai-broken-1");
      await backlog(home);
      assert.equal(await raceCode(home, spec), 1);
      assert.equal((await archiveOf(home)).at(-1).id, "race-essai-broken-1-r1");
    }));

  it("fills the command's placeholders, and refuses a spec it cannot run", async () => {
    const folder = path.resolve("E:/Dev/projet");
    const spec = { id: "v11", cwd: folder, folder: path.join(folder, "races", "v11"), command: "node a.js --variant {variant} --seeds {from}:{count} --out {out}", estimate: "5 min", threads: 3, priority: 1 };
    const job = jobOf(spec, "rampe-a", { from: 51, count: 50 });
    assert.equal(job.id, "race-v11-rampe-a-51");
    assert.equal(job.command, "node a.js --variant rampe-a --seeds 51:50 --out races/v11/rampe-a/51.jsonl");
    assert.deepEqual([job.cwd, job.threads, job.priority, job.estimate], [folder, 3, 1, "5 min"]);
    await scratch(async (_home, dir) => {
      const write = async (spec2) => {
        const file = path.join(dir, "c.json");
        await writeFile(file, JSON.stringify(spec2));
        return file;
      };
      await assert.rejects(readSpec(await write({ id: "a b", variants: ["x", "y"], command: "{variant}{from}{count}{out}" })), /lettres/);
      await assert.rejects(readSpec(await write({ id: "a", variants: ["x"], command: "{variant}{from}{count}{out}" })), /deux variantes/);
      await assert.rejects(readSpec(await write({ id: "a", variants: ["x", "y"], command: "{variant}" })), /\{from\}/);
      const ok = await readSpec(await write({ id: "a", variants: ["x", "y"], command: "{variant}{from}{count}{out}" }));
      assert.deepEqual([ok.batch, ok.maxSeeds, ok.looks, ok.cwd], [50, 1000, 20, dir]);
    });
  });
});

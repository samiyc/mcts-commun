import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RUNNER, archiveOf, backlog, codeOf, journalOf, quiet, run, scratch, sleeper, statusOf } from "./fixtures/backlog-cli.js";

/**
 * The machine's slots (bin/backlog.js --slot, docs/backlog.md, Sami 27-28/10/2026): a session's short test waits for
 * free threads, is served before the queue's next job, stays short, and a short job fills the gap it leaves.
 */
describe("the machine's slots (bin/backlog.js --slot, docs/backlog.md)", () => {
  it("runs a session's command in the machine's slots: it waits for free threads, then gives them back (Sami, 27/10)", () =>
    scratch(async (home) => {
      // Two commands of 2 threads on a budget of 2: the second waits for the first.
      const stamp = (word) => `node -e "console.log('${word}', Date.now()); setTimeout(() => console.log('${word}-fin', Date.now()), 400)"`;
      const slot = (word) => run(process.execPath, [RUNNER, "--home", home, "--budget", "2", "--slot", "2", "--id", word, "--", stamp(word)], { env: quiet });
      const [first, second] = await Promise.all([slot("un"), slot("deux")]);
      const times = Object.fromEntries(`${first.stdout}${second.stdout}`.trim().split(/\r?\n/).map((line) => line.split(" ")).map(([word, at]) => [word, Number(at)]));
      const [a, b] = times.un < times.deux ? ["un", "deux"] : ["deux", "un"];
      assert.ok(times[b] >= times[`${a}-fin`], JSON.stringify(times));
      assert.match(first.stderr + second.stderr, /attend 2 fil\(s\), 2\/2 pris/);
      assert.deepEqual(JSON.parse(await readFile(path.join(home, "slots.json"), "utf8")).slots, []);
      assert.equal(await codeOf(home, "--slot", "1", "--", 'node -e "process.exit(3)"'), 3, "le code de la commande");
      // Each in the journal, its start and its end, for the Tests tab (Sami, 28/10/2026).
      const lines = await journalOf(home);
      const ends = lines.filter((entry) => entry.kind === "slot-ended");
      assert.deepEqual(ends.map((entry) => entry.code).sort(), [0, 0, 3]);
      assert.equal(lines.filter((entry) => entry.kind === "slot-started").length, 3);
      assert.ok(lines.find((entry) => entry.kind === "slot-started" && entry.id === b).waitedMin > 0, "le second a attendu");
      // The same id again right after its end: a series, which waits like a job (codingame's arena, 28/10/2026).
      await backlog(home, "--budget", "2", "--slot", "1", "--id", "un", "--", 'node -e "0"');
      const again = await journalOf(home);
      assert.deepEqual(again.filter((entry) => entry.kind === "slot-started" && entry.id === "un").map((entry) => entry.series), [false, true]);
    }));

  it("serves a short test before the queue: a job just started gives its threads back and starts again later (Sami, 27/10)", () =>
    scratch(async (home, folder) => {
      await backlog(home, "--add", "long", "--cwd", folder, "--estimate", "1 min", "--threads", "2", "--", sleeper(30_000));
      const runner = spawn(process.execPath, [RUNNER, "--home", home, "--budget", "2"], { env: quiet });
      const ended = new Promise((resolve) => runner.once("exit", resolve));
      while ((await statusOf(home, "long")).status !== "running") await new Promise((resolve) => setTimeout(resolve, 50));
      const started = Date.now();
      const test = await run(process.execPath, [RUNNER, "--home", home, "--budget", "2", "--slot", "1", "--id", "court", "--", 'node -e "console.log(\'test court\')"'], { env: quiet });
      assert.match(test.stdout, /test court/);
      assert.ok(Date.now() - started < 15_000, `${Date.now() - started} ms : le test court n'a pas attendu les 30 s du job`);
      assert.ok((await journalOf(home)).some((entry) => entry.kind === "job-preempted" && entry.id === "long"));
      // Back in the queue, it starts again once the test is done.
      while ((await statusOf(home, "long")).status !== "running") await new Promise((resolve) => setTimeout(resolve, 50));
      await backlog(home, "--cancel", "long");
      await ended;
      assert.equal((await statusOf(home, "long")).status, "cancelled");
    }));

  it("keeps a short test short: more than 4 threads refused, stopped at its time limit (Sami, 28/10: no hour on 12 threads)", () =>
    scratch(async (home) => {
      const big = await run(process.execPath, [RUNNER, "--home", home, "--slot", "5", "--", 'node -e "0"'], { env: quiet }).catch((error) => error);
      assert.equal(big.code, 2);
      assert.match(big.stderr, /c'est un job, pas un test court \(4 au plus\)/);
      // The limit shortened for the test (MCTS_SLOT_LIMIT_MS may only shorten it): the command killed, code 124.
      const started = Date.now();
      const long = await run(process.execPath, [RUNNER, "--home", home, "--slot", "1", "--id", "long", "--", sleeper(30_000)], { env: { ...quiet, MCTS_SLOT_LIMIT_MS: "500" } }).catch((error) => error);
      assert.equal(long.code, 124);
      assert.ok(Date.now() - started < 15_000, `${Date.now() - started} ms`);
      assert.match(long.stderr, /arrêté après 15 min/);
      assert.deepEqual((await journalOf(home)).filter((entry) => entry.kind === "slot-ended").map(({ id, code, stopped }) => [id, code, stopped]), [["long", 124, true]]);
      assert.deepEqual(JSON.parse(await readFile(path.join(home, "slots.json"), "utf8")).slots, [], "its threads given back");
    }));

  it("fills the gap with a short job while the next waits for the threads of a session's test (Sami, 28/10)", () =>
    scratch(async (home, folder) => {
      // A session's test holds 2 of 4 threads; the next job wants 4, a short one 1.
      const tenant = spawn(process.execPath, [RUNNER, "--home", home, "--budget", "4", "--slot", "2", "--id", "locataire", "--", sleeper(2_500)], { env: quiet });
      const gone = new Promise((resolve) => tenant.once("exit", resolve));
      while (!(await readFile(path.join(home, "slots.json"), "utf8").catch(() => "")).includes("locataire")) await new Promise((resolve) => setTimeout(resolve, 50));
      await backlog(home, "--add", "gros", "--cwd", folder, "--estimate", "1 min", "--threads", "4", "--", sleeper(200));
      await backlog(home, "--add", "petit", "--cwd", folder, "--estimate", "1 min", "--threads", "1", "--", sleeper(200));
      await backlog(home, "--budget", "4");
      await gone;
      const lines = await journalOf(home);
      const order = lines.filter((entry) => entry.kind === "job-started").map((entry) => entry.id);
      assert.deepEqual(order, ["petit", "gros"], "le petit dans le trou, le gros après le test");
      assert.ok(lines.some((entry) => entry.kind === "gap-filled" && entry.id === "petit" && entry.waiting === "gros" && entry.others === 2));
      assert.deepEqual((await archiveOf(home)).map((job) => job.status), ["done", "done"]);
    }));
});

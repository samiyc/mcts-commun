import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

/**
 * The backlog opened to other tools (Sami, 26/10/2026: other applications must add jobs and follow them): the queue
 * locked between processes, `--status`, `--wait`, `--cancel`, `--retry`, a job's `skipIf`. docs/backlog.md states
 * the same contract.
 */
const run = promisify(execFile);
const RUNNER = fileURLToPath(new URL("../bin/backlog.js", import.meta.url));
const quiet = { ...process.env, MCTS_HEAT_ALERT: "0", MCTS_SENSORS_URL: "http://127.0.0.1:9/", MCTS_RAM_FLOOR: "0", MCTS_BACKLOG_POLL_MS: "50" };
const backlog = (home, ...args) => run(process.execPath, [RUNNER, "--home", home, ...args], { env: quiet });
/** The exit code of a command that may fail on purpose (`--wait`, `--status` of an unknown job). */
const codeOf = (home, ...args) => backlog(home, ...args).then(
  () => 0,
  (error) => error.code,
);
const sleeper = (ms) => `node -e "setTimeout(() => {}, ${ms})"`;
const archiveOf = async (home) => (await Promise.all((await readdir(path.join(home, "done"))).map(async (name) => JSON.parse(await readFile(path.join(home, "done", name), "utf8"))))).flat();
const statusOf = async (home, id) => JSON.parse((await backlog(home, "--status", id, "--json")).stdout);

async function scratch(work) {
  const home = await mkdtemp(path.join(os.tmpdir(), "backlog-"));
  const folder = await mkdtemp(path.join(os.tmpdir(), "projet-"));
  try {
    await work(home, folder);
  } finally {
    await rm(home, { recursive: true, force: true, maxRetries: 5 });
    await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  }
}

describe("the backlog for other tools (bin/backlog.js, docs/backlog.md, Sami 26/10)", () => {
  it("loses nothing when twenty tools add jobs while the runner writes its own", () =>
    scratch(async (home, folder) => {
      for (let i = 0; i < 6; i += 1) await backlog(home, "--add", `r${i}`, "--cwd", folder, "--estimate", "1 min", "--", sleeper(100));
      const runner = backlog(home, "--budget", "3");
      await Promise.all(Array.from({ length: 20 }, (_, i) => backlog(home, "--add", `t${i}`, "--cwd", folder, "--estimate", "1 min", "--priority", "3", "--", sleeper(10))));
      await runner;
      // The runner may have ended before the last additions: it runs what is left.
      await backlog(home, "--budget", "3");
      const archive = await archiveOf(home);
      assert.equal(archive.length, 26);
      assert.ok(archive.every((job) => job.status === "done"), JSON.stringify(archive.filter((job) => job.status !== "done")));
      assert.deepEqual(JSON.parse(await readFile(path.join(home, "queue.json"), "utf8")).jobs, []);
    }));

  it("runs each job once when two runners play the same queue", () =>
    scratch(async (home, folder) => {
      for (let i = 0; i < 10; i += 1) await backlog(home, "--add", `j${i}`, "--cwd", folder, "--estimate", "1 min", "--", sleeper(150));
      await Promise.all([backlog(home, "--budget", "4"), backlog(home, "--budget", "4")]);
      const archive = await archiveOf(home);
      assert.deepEqual(archive.map((job) => job.id).sort(), Array.from({ length: 10 }, (_, i) => `j${i}`).sort());
      assert.equal((await readdir(path.join(home, "runs"))).length, 10, "one output a job: none started twice");
    }));

  it("says where a job stands, and waits for its end with an exit code a tool can read", () =>
    scratch(async (home, folder) => {
      await backlog(home, "--add", "ok", "--cwd", folder, "--estimate", "1 min", "--", sleeper(10));
      await backlog(home, "--add", "bad", "--cwd", folder, "--estimate", "2 min", "--", 'node -e "process.exit(3)"');
      await backlog(home, "--add", "next", "--cwd", folder, "--estimate", "1 min", "--after", "bad", "--", sleeper(10));
      const planned = await statusOf(home, "ok");
      assert.equal(planned.status, "todo");
      assert.equal(planned.place, "queue");
      assert.ok(Date.parse(planned.plannedStart) > 0);
      assert.equal(await codeOf(home, "--wait", "ok", "--timeout", "0"), 4, "still to come");
      await backlog(home);
      const ended = await statusOf(home, "ok");
      assert.deepEqual([ended.status, ended.place, ended.finished], ["done", "archive", true]);
      assert.ok(path.isAbsolute(ended.output));
      assert.equal(await codeOf(home, "--wait", "ok"), 0);
      assert.equal(await codeOf(home, "--wait", "bad"), 1);
      assert.equal((await statusOf(home, "next")).blocked, true);
      assert.equal(await codeOf(home, "--wait", "personne"), 3);
      assert.equal(await codeOf(home, "--status", "personne"), 3);
    }));

  it("cancels a job to come at once, and a running one through its runner; retries a finished one", () =>
    scratch(async (home, folder) => {
      await backlog(home, "--add", "long", "--cwd", folder, "--estimate", "1 min", "--", sleeper(30_000));
      await backlog(home, "--add", "later", "--cwd", folder, "--estimate", "1 min", "--after", "long", "--", sleeper(10));
      await backlog(home, "--add", "after-later", "--cwd", folder, "--estimate", "1 min", "--after", "later", "--", sleeper(10));
      await backlog(home, "--cancel", "later");
      assert.equal((await statusOf(home, "later")).status, "cancelled");
      const runner = spawn(process.execPath, [RUNNER, "--home", home], { env: quiet });
      const ended = new Promise((resolve) => runner.once("exit", resolve));
      while ((await statusOf(home, "long")).status !== "running") await new Promise((resolve) => setTimeout(resolve, 50));
      const started = Date.now();
      assert.match((await backlog(home, "--cancel", "long")).stdout, /marqué/);
      await ended;
      assert.ok(Date.now() - started < 10_000, "stopped well before its 30 s");
      assert.equal(await codeOf(home, "--wait", "long"), 2);
      // Killed with its processes, it could not end its trace: its runner did (27/10, a cancelled job shown "silent").
      const last = JSON.parse((await readFile((await statusOf(home, "long")).trace, "utf8")).trim().split("\n").at(-1));
      assert.deepEqual([last.kind, last.stoppedBy, last.status], ["end", "mcts-backlog", "cancelled"]);
      assert.equal((await statusOf(home, "after-later")).waiting, "later : cancelled");
      const again = (await backlog(home, "--retry", "long")).stdout;
      assert.match(again, /long-r1/);
      const retried = await statusOf(home, "long-r1");
      assert.deepEqual([retried.status, retried.retryOf, retried.command], ["todo", "long", sleeper(30_000)]);
      assert.ok(!("cancel" in retried) && !("doneAt" in retried));
      await assert.rejects(backlog(home, "--retry", "long-r1"), /pas fini/);
    }));

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
      const lines = (await readFile(path.join(home, "journal", (await readdir(path.join(home, "journal")))[0]), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const ends = lines.filter((entry) => entry.kind === "slot-ended");
      assert.deepEqual(ends.map((entry) => entry.code).sort(), [0, 0, 3]);
      assert.equal(lines.filter((entry) => entry.kind === "slot-started").length, 3);
      assert.ok(lines.find((entry) => entry.kind === "slot-started" && entry.id === b).waitedMin > 0, "le second a attendu");
      // The same id again right after its end: a series, which waits like a job (codingame's arena, 28/10/2026).
      await backlog(home, "--budget", "2", "--slot", "1", "--id", "un", "--", 'node -e "0"');
      const again = (await readFile(path.join(home, "journal", (await readdir(path.join(home, "journal")))[0]), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
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
      const journal = await readFile(path.join(home, "journal", (await readdir(path.join(home, "journal")))[0]), "utf8");
      assert.match(journal, /"kind":"job-preempted","id":"long"/);
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
      const lines = (await readFile(path.join(home, "journal", (await readdir(path.join(home, "journal")))[0]), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      assert.deepEqual(lines.filter((entry) => entry.kind === "slot-ended").map(({ id, code, stopped }) => [id, code, stopped]), [["long", 124, true]]);
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
      const lines = (await readFile(path.join(home, "journal", (await readdir(path.join(home, "journal")))[0]), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const order = lines.filter((entry) => entry.kind === "job-started").map((entry) => entry.id);
      assert.deepEqual(order, ["petit", "gros"], "le petit dans le trou, le gros après le test");
      assert.ok(lines.some((entry) => entry.kind === "gap-filled" && entry.id === "petit" && entry.waiting === "gros" && entry.others === 2));
      assert.deepEqual((await archiveOf(home)).map((job) => job.status), ["done", "done"]);
    }));

  it("refuses a job whose folder does not exist, before it fails at night (urgences, 27/10)", () =>
    scratch(async (home, folder) => {
      await assert.rejects(backlog(home, "--add", "perdu", "--cwd", path.join(folder, "absent"), "--", sleeper(10)), /dossier introuvable/);
      assert.equal(await codeOf(home, "--status", "perdu"), 3);
    }));

  it("skips a job its skipIf answers 0 for, with the reason it printed; runs it otherwise", () =>
    scratch(async (home, folder) => {
      await backlog(home, "--add", "skip", "--cwd", folder, "--skip-if", `node -e "console.log('déjà mesuré')"`, "--", sleeper(10));
      await backlog(home, "--add", "keep", "--cwd", folder, "--skip-if", 'node -e "process.exit(1)"', "--", sleeper(10));
      await backlog(home);
      const byId = Object.fromEntries((await archiveOf(home)).map((job) => [job.id, job]));
      assert.deepEqual([byId.skip.status, byId.skip.reason], ["skipped", "déjà mesuré"]);
      assert.equal(byId.keep.status, "done");
      const journal = await readFile(path.join(home, "journal", (await readdir(path.join(home, "journal")))[0]), "utf8");
      assert.match(journal, /"kind":"job-skipped","id":"skip"/);
    }));
});

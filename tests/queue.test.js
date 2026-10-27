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

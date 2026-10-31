import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { RUNNER, archiveOf, backlog, codeOf, quiet, scratch, sleeper, statusOf } from "./fixtures/backlog-cli.js";

/**
 * The runners on one queue (bin/backlog.js, docs/backlog.md): two of them never run a job twice, a job is cancelled
 * through its runner, retried and moved in priority; the permanent runner waits on an empty queue (Sami, 29/10/2026).
 */
describe("the runners on one queue (bin/backlog.js, docs/backlog.md)", () => {
  it("runs each job once when two runners play the same queue", () =>
    scratch(async (home, folder) => {
      for (let i = 0; i < 10; i += 1) await backlog(home, "--add", `j${i}`, "--cwd", folder, "--estimate", "1 min", "--", sleeper(150));
      await Promise.all([backlog(home, "--budget", "4"), backlog(home, "--budget", "4")]);
      const archive = await archiveOf(home);
      assert.deepEqual(archive.map((job) => job.id).sort(), Array.from({ length: 10 }, (_, i) => `j${i}`).sort());
      assert.equal((await readdir(path.join(home, "runs"))).length, 10, "one output a job: none started twice");
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
      // A job to come moved in place, by a pattern; a retry at another priority (cuisine, 28/10: 115 cancellations).
      assert.match((await backlog(home, "--set-priority", "long-*", "3")).stdout, /Priorité 3 : long-r1/);
      assert.equal((await statusOf(home, "long-r1")).priority, 3);
      assert.equal(await codeOf(home, "--set-priority", "nobody-*", "1"), 3, "no job to come matches");
      await assert.rejects(backlog(home, "--set-priority", "long-r1", "5"), /1, 2 ou 3/);
      await backlog(home, "--retry", "long", "--priority", "1");
      assert.equal((await statusOf(home, "long-r2")).priority, 1);
    }));

  it("stays with --stay: waits on an empty queue, runs a job added later, lets no second one start (Sami, 29/10)", () =>
    scratch(async (home, folder) => {
      const runner = spawn(process.execPath, [RUNNER, "--home", home, "--stay"], { env: quiet });
      const ended = new Promise((resolve) => runner.once("exit", resolve));
      try {
        while (!(await readFile(path.join(home, "stay.json"), "utf8").catch(() => ""))) await new Promise((resolve) => setTimeout(resolve, 50));
        assert.match((await backlog(home, "--stay")).stdout, new RegExp(`tourne déjà \\(pid ${runner.pid}`));
        await backlog(home, "--add", "later", "--cwd", folder, "--estimate", "1 min", "--", sleeper(10));
        assert.equal(await codeOf(home, "--wait", "later", "--timeout", "1"), 0);
        assert.equal(runner.exitCode, null, "still there once the queue is empty again");
        const view = JSON.parse((await backlog(home, "--list", "--json")).stdout);
        assert.ok(view.runners.some((one) => one.pid === runner.pid && one.alive && one.stay), "shown, as the permanent runner");
        const journal = await readFile(path.join(home, "journal", (await readdir(path.join(home, "journal")))[0]), "utf8");
        assert.equal(journal.match(/"kind":"runner-idle"/g)?.length, 2, "said once a time the queue went empty");
      } finally {
        runner.kill();
        await ended;
      }
    }));
});

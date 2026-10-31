import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { archiveOf, backlog, codeOf, journalOf, scratch, sleeper, statusOf } from "./fixtures/backlog-cli.js";

/**
 * The backlog opened to other tools (Sami, 26/10/2026: other applications must add jobs and follow them): the queue
 * locked between processes, `--status`, `--wait`, a job's `skipIf`, a folder that does not exist. docs/backlog.md states
 * the same contract. The runners' races, the slots and the permanent runner have their own files (31/10/2026).
 */
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
      assert.ok((await journalOf(home)).some((entry) => entry.kind === "job-skipped" && entry.id === "skip"));
    }));

  it("holds a job until its time with --not-before, and refuses a time it cannot read (Sami, 29/10)", () =>
    scratch(async (home, folder) => {
      await backlog(home, "--add", "night", "--cwd", folder, "--not-before", "2099-01-01T20:00", "--", sleeper(10));
      const night = await statusOf(home, "night");
      assert.deepEqual([night.status, night.notBefore], ["scheduled", "2099-01-01T20:00"]);
      await assert.rejects(backlog(home, "--add", "bad", "--cwd", folder, "--not-before", "ce soir", "--", sleeper(10)), /illisible/);
      assert.match((await backlog(home, "--set-priority", "night", "1")).stdout, /night/, "a scheduled job is a job to come");
      await backlog(home);
      assert.equal((await statusOf(home, "night")).status, "scheduled", "a runner without --stay does not wait for it");
    }));
});

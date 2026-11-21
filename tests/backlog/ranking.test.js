import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { viewOf } from "../../node/backlog/view.js";
import { RANKING_SINCE, checkRanking, readRanking, setRanking, staleRunner, withRank } from "../../node/queue/ranking.js";
import { archiveOf, backlog, scratch, sleeper } from "../fixtures/backlog-cli.js";

/**
 * Sami's ranking of the projects (21/11/2026: « voyage en top 1, puis recrutement, puis codingame »), node/queue/ranking.js:
 * strict, a better-ranked project's jobs first whatever their priorities; written by --rank, the TUI's P and the page.
 */
describe("the ranking of the projects (node/queue/ranking.js, docs/backlog.md)", () => {
  it("checks the names, ranks the jobs by their folder, copies and worktrees included", () => {
    assert.deepEqual(checkRanking([" Voyage", "recrutement", ""]), ["voyage", "recrutement"]);
    assert.throws(() => checkRanking(["voyage", "toto"]), /projet inconnu : toto/);
    assert.throws(() => checkRanking(["voyage", "voyage"]), /en double : voyage/);
    const jobs = [
      { id: "a", cwd: "E:/Dev/My projects/voyage-afrique-sud" },
      { id: "b", cwd: "E:/Dev/My projects/mcts-codingame-wt/c4l4" },
      { id: "c", cwd: "E:/Dev/My projects/raquette" },
    ];
    const ranked = withRank(jobs, { projects: ["voyage", "recrutement", "codingame"] });
    assert.deepEqual(ranked.map((job) => job.rank), [1, 3, undefined]);
    assert.equal(withRank(jobs, null), jobs, "no ranking, the jobs as they are");
    assert.ok(!("rank" in jobs[0]), "never written into the queue's jobs");
  });

  it("writes, reads, journals and clears the ranking; says when the permanent runner is older", () =>
    scratch(async (home) => {
      const said = [];
      assert.equal(await readRanking(home), null);
      const written = await setRanking(home, ["voyage", "codingame"], { by: "page", journal: (kind, fields) => said.push({ kind, ...fields }) });
      assert.deepEqual([written.projects, written.by], [["voyage", "codingame"], "page"]);
      assert.deepEqual((await readRanking(home)).projects, ["voyage", "codingame"]);
      assert.deepEqual(said, [{ kind: "ranking-set", projects: ["voyage", "codingame"], by: "page" }]);
      assert.equal(await setRanking(home, []), null);
      assert.equal(await readRanking(home), null);
      assert.equal(staleRunner({ since: "2026-11-21T08:16:49.123Z" }), true);
      assert.equal(staleRunner({ since: RANKING_SINCE }), false);
      assert.equal(staleRunner(null), false);
    }));

  it("is set and read by --rank, refused for an unknown name, and the runner plays the ranked project first", () =>
    scratch(async (home, folder) => {
      const dirs = {};
      for (const name of ["voyage-afrique-sud", "raquette", "lopin"]) {
        dirs[name] = path.join(folder, name);
        await mkdir(dirs[name]);
      }
      assert.match((await backlog(home, "--rank")).stdout, /aucune/);
      await assert.rejects(backlog(home, "--rank", "voyage,toto"), /projet inconnu : toto/);
      assert.match((await backlog(home, "--rank", "voyage,raquette")).stdout, /1 voyage · 2 raquette/);
      // Without the ranking: lopin's urgent short job first, voyage's long one that can wait last.
      await backlog(home, "--add", "lopin-urgent", "--cwd", dirs.lopin, "--priority", "1", "--estimate", "1 min", "--", sleeper(10));
      await backlog(home, "--add", "raq", "--cwd", dirs.raquette, "--estimate", "5 min", "--", sleeper(10));
      await backlog(home, "--add", "voy", "--cwd", dirs["voyage-afrique-sud"], "--priority", "3", "--estimate", "50 min", "--", sleeper(10));
      assert.match((await backlog(home, "--list")).stdout, /Priorités : 1 voyage · 2 raquette/);
      await backlog(home, "--budget", "1");
      const order = (await archiveOf(home)).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt))).map((job) => job.id);
      assert.deepEqual(order, ["voy", "raq", "lopin-urgent"]);
      const journal = await readFile(path.join(home, "journal", `${new Date().toISOString().slice(0, 7)}.jsonl`), "utf8").catch(() => "");
      assert.match(journal, /"kind":"ranking-set"/);
      assert.match((await backlog(home, "--rank", "aucun")).stdout, /aucune/);
    }));

  it("makes the views plan in the ranked order and say the ranking", () => {
    const now = Date.parse("2026-11-21T12:00:00");
    const job = (id, cwd, priority) => ({ id, cwd, priority, command: "x", estimate: "10 min", status: "todo" });
    const state = {
      now,
      budget: 1,
      jobs: [job("raq", "E:/Dev/My projects/raquette", 1), job("voy", "E:/Dev/My projects/voyage-afrique-sud", 3)],
      archive: [],
      slots: [],
      ranking: { projects: ["voyage"] },
      stay: { pid: 1, since: "2026-11-20T09:00:00.000Z" },
    };
    const view = viewOf(state);
    assert.deepEqual(view.planned.map((one) => one.id), ["voy", "raq"]);
    assert.deepEqual(view.ranking, { projects: ["voyage"], text: "1 voyage", stale: true });
    assert.deepEqual(viewOf({ ...state, ranking: null }).planned.map((one) => one.id), ["raq", "voy"]);
  });
});

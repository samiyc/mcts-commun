import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

/**
 * The queue on another machine (node/remote.js, docs/distant.md, Sami 26/10/2026), played here with the folder
 * transport: a temporary folder stands for the server, the same commands as over ssh. The real first run waits for
 * Sami's server.
 */
const run = promisify(execFile);
const RUNNER = fileURLToPath(new URL("../bin/backlog.js", import.meta.url));
const quiet = { ...process.env, MCTS_HEAT_ALERT: "0", MCTS_SENSORS_URL: "http://127.0.0.1:9/", MCTS_RAM_FLOOR: "0", MCTS_BACKLOG_POLL_MS: "50" };
const backlog = (home, ...args) => run(process.execPath, [RUNNER, "--home", home, ...args], { env: quiet });
const viewOf = async (home, ...args) => JSON.parse((await backlog(home, "--json", ...args)).stdout);

describe("the queue on another machine (node/remote.js), through a folder standing for it", () => {
  it("leaves a job for another machine to it: sent with its folder, run there, its end and its files brought back", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "backlog-"));
    const remote = await mkdtemp(path.join(os.tmpdir(), "serveur-"));
    const project = await mkdtemp(path.join(os.tmpdir(), "projet-"));
    try {
      await writeFile(path.join(home, "machines.json"), JSON.stringify({ essai: { folder: remote } }));
      await writeFile(path.join(project, "package.json"), JSON.stringify({ name: "projet", dependencies: { "mcts-commun": "file:../mcts-commun" } }));
      const write = `node -e "require('fs').writeFileSync('resultat.txt', 'fait, bibliothèque ' + require('fs').existsSync('node_modules/mcts-commun/package.json'))"`;
      await writeFile(path.join(project, "night.json"), JSON.stringify({ jobs: [{ id: "loin", command: write, estimate: "1 min", returns: ["resultat.txt"] }] }));
      await backlog(home, "--add-file", path.join(project, "night.json"), "--no-tag", "--machine", "essai");

      // The local runner leaves it; the views say where it goes.
      await backlog(home);
      assert.equal((await viewOf(home)).waiting.find((job) => job.id === "loin").reason, "pour essai (--push essai)");
      assert.match((await backlog(home, "--push", "essai")).stdout, /Envoyé à essai : loin/);
      assert.ok((await stat(path.join(remote, "mcts-commun", "bin", "backlog.js"))).isFile());
      await assert.rejects(stat(path.join(remote, "mcts-commun", "node_modules")), "node_modules stays home");
      assert.match((await viewOf(home)).waiting.find((job) => job.id === "loin").reason, /^sur essai, envoyé/);
      assert.match((await backlog(home, "--push", "essai")).stdout, /Rien à envoyer/);

      // Its runner plays it there.
      let there = await viewOf(home, "--machine", "essai");
      for (let tries = 0; there.finished.length === 0 && tries < 200; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        there = await viewOf(home, "--machine", "essai");
      }
      assert.deepEqual(there.finished.map((job) => [job.id, job.status]), [["loin", "done"]]);

      assert.match((await backlog(home, "--pull", "essai")).stdout, /1 fini\(s\) rapatrié\(s\) \(loin\)/);
      const archive = JSON.parse(await readFile(path.join(home, "done", (await readdir(path.join(home, "done")))[0]), "utf8"));
      const loin = archive.find((job) => job.id === "loin");
      assert.equal(loin.status, "done");
      assert.ok((await stat(path.join(home, loin.output))).isFile(), "its output brought back");
      assert.equal(await readFile(path.join(project, "resultat.txt"), "utf8"), "fait, bibliothèque true");
      assert.deepEqual(JSON.parse(await readFile(path.join(home, "queue.json"), "utf8")).jobs, []);
    } finally {
      for (const folder of [home, remote, project]) await rm(folder, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  it("refuses a machine machines.json does not name", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "backlog-"));
    try {
      await assert.rejects(backlog(home, "--push", "nulle-part"), /machine inconnue : nulle-part/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

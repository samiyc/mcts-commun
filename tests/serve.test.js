import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../bin/serve.js", import.meta.url));
/** The port a server started on port 0 says it took, in its first line. */
const portOf = (server) => new Promise((resolve) => server.stdout.once("data", (data) => resolve(Number(/:(\d+)\//.exec(String(data))[1]))));

describe("the page server's replays (bin/serve.js, Sami 23/10: stored by themselves, out of git)", () => {
  it("writes a posted replay to replays/, lists it, and refuses what is not one", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "serve-"));
    const server = spawn(process.execPath, [SERVER, "0"], { cwd: folder });
    const port = await portOf(server);
    const url = `http://127.0.0.1:${port}/api/replays`;
    try {
      const posted = await fetch(url, { method: "POST", body: JSON.stringify({ format: "urgences-replay/1", hospital: "moyen", seed: 4, savedAt: "2026-10-23T19:00:00.000Z", choices: [3, 1] }) });
      assert.equal(posted.status, 201);
      assert.equal((await posted.json()).file, "replays/urgences_2026-10-23-19-00-00_moyen-4.json");
      assert.deepEqual(JSON.parse(await readFile(path.join(folder, "replays", "urgences_2026-10-23-19-00-00_moyen-4.json"), "utf8")).choices, [3, 1]);
      assert.deepEqual((await (await fetch(url)).json()).files, ["urgences_2026-10-23-19-00-00_moyen-4.json"]);
      assert.equal((await fetch(url, { method: "POST", body: "pas du json" })).status, 400);
      assert.equal((await fetch(url, { method: "POST", body: JSON.stringify({ any: 1 }) })).status, 400);
      assert.equal((await readdir(path.join(folder, "replays"))).length, 1);
    } finally {
      // The server runs in the folder: it must be gone before the folder can go (Windows).
      const gone = new Promise((resolve) => server.once("exit", resolve));
      server.kill();
      await gone;
      await rm(folder, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  it("shows the machine's backlog, read only: the view, the end of a job's output (Sami 26/10)", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "serve-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "backlog-"));
    await mkdir(path.join(home, "runs"));
    await mkdir(path.join(home, "done"));
    await writeFile(path.join(home, "runs", "2026-10-26-19-00_a.txt"), "début\njour 3/100\n");
    await writeFile(path.join(home, "done", "2026-10.json"), JSON.stringify([{ id: "a", cwd: folder, command: "x", estimate: "5 min", status: "done", doneAt: "2026-10-26T19:05", minutes: 5, output: path.join("runs", "2026-10-26-19-00_a.txt") }]));
    await writeFile(path.join(home, "queue.json"), JSON.stringify({ jobs: [{ id: "b", cwd: folder, command: "y", estimate: "1 h", status: "todo" }] }));
    const server = spawn(process.execPath, [SERVER, "0"], { cwd: folder, env: { ...process.env, MCTS_BACKLOG_HOME: home, MCTS_SENSORS_URL: "http://127.0.0.1:9/" } });
    const port = await portOf(server);
    const base = `http://127.0.0.1:${port}`;
    try {
      const view = await (await fetch(`${base}/api/backlog`)).json();
      assert.deepEqual(view.planned.map((job) => job.id), ["b"]);
      assert.deepEqual(view.finished.map((job) => job.id), ["a"]);
      const tail = await (await fetch(`${base}/api/backlog/tail?id=a&kind=output`)).json();
      assert.deepEqual(tail.lines, ["début", "jour 3/100"]);
      assert.equal((await fetch(`${base}/api/backlog/tail?id=personne`)).status, 404);
      assert.equal((await fetch(`${base}/`)).status, 404);
      assert.deepEqual((await readdir(home)).sort(), ["done", "queue.json", "runs"], "nothing written to the backlog");
    } finally {
      const gone = new Promise((resolve) => server.once("exit", resolve));
      server.kill();
      await gone;
      await rm(folder, { recursive: true, force: true, maxRetries: 5 });
      await rm(home, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});

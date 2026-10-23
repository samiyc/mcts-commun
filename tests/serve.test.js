import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../bin/serve.js", import.meta.url));

describe("the page server's replays (bin/serve.js, Sami 23/10: stored by themselves, out of git)", () => {
  it("writes a posted replay to replays/, lists it, and refuses what is not one", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "serve-"));
    const port = 4900 + Math.floor(Math.random() * 90);
    const server = spawn(process.execPath, [SERVER, String(port)], { cwd: folder });
    await new Promise((resolve) => server.stdout.once("data", resolve));
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
});

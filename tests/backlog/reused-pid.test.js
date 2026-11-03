import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readSlots } from "../../node/machine.js";
import { readStay } from "../../node/queue/stay.js";
import { readWanted } from "../../node/queue/wanted.js";
import { RUNNER, backlog, journalOf, quiet, scratch, sleeper, statusOf } from "../fixtures/backlog-cli.js";

/**
 * A number the system gave to another program (3/11/2026: a svchost held the number of the runner stopped with the PC).
 * `work(pid)` runs while a process that is not node lives under `pid`.
 */
async function withStranger(work) {
  const [file, args] = process.platform === "win32" ? [path.join(process.env.SystemRoot, "System32", "PING.EXE"), ["-n", "120", "127.0.0.1"]] : ["/bin/sleep", ["120"]];
  const stranger = spawn(file, args, { stdio: "ignore" });
  const ended = new Promise((resolve) => stranger.once("exit", resolve));
  await new Promise((resolve) => stranger.once("spawn", resolve));
  try {
    await work(stranger.pid);
  } finally {
    stranger.kill();
    await ended;
  }
}

const idsOf = (slots) => slots.map((slot) => slot.id);
const stayOf = async (home) => JSON.parse(await readFile(path.join(home, "stay.json"), "utf8").catch(() => "{}"));

describe("a pid another program took (node/processes.js)", () => {
  it("holds no thread, wants none, and is no permanent runner", () =>
    scratch((home) =>
      withStranger(async (pid) => {
        const since = "2026-11-03T08:00:00.000Z";
        await writeFile(path.join(home, "slots.json"), JSON.stringify({ slots: [{ pid, runner: "session", id: "gone", threads: 18, since }, { pid: process.pid, runner: "session", id: "me", threads: 1, since }] }));
        await writeFile(path.join(home, "wanted.json"), JSON.stringify({ wanted: [{ pid, id: "gone", threads: 4 }] }));
        await writeFile(path.join(home, "stay.json"), JSON.stringify({ pid, since }));
        assert.deepEqual(idsOf(await readSlots(home)), ["me"]);
        assert.deepEqual(await readWanted(home), []);
        assert.equal(await readStay(home), null);
      }),
    ));

  it("does not show as a runner in the views", () =>
    scratch((home) =>
      withStranger(async (pid) => {
        await mkdir(path.join(home, "journal"));
        await writeFile(path.join(home, "journal", "2026-11.jsonl"), `${JSON.stringify({ at: "2026-11-03T08:00:00.000Z", pid, kind: "runner-idle" })}\n`);
        assert.deepEqual(JSON.parse((await backlog(home, "--list", "--json")).stdout).runners, []);
      }),
    ));

  it("does not keep a --stay at logon from starting the queue", () =>
    scratch((home) =>
      withStranger(async (pid) => {
        await writeFile(path.join(home, "stay.json"), JSON.stringify({ pid, since: "2026-11-03T08:00:00.000Z" }));
        const runner = spawn(process.execPath, [RUNNER, "--home", home, "--stay"], { env: quiet, stdio: "ignore" });
        const ended = new Promise((resolve) => runner.once("exit", resolve));
        try {
          while ((await stayOf(home)).pid !== runner.pid) {
            assert.equal(runner.exitCode, null, "the runner left");
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        } finally {
          runner.kill();
          await ended;
        }
      }),
    ));

  it("gives back to the queue a job left running under it", () =>
    scratch((home, folder) =>
      withStranger(async (pid) => {
        await backlog(home, "--add", "left", "--cwd", folder, "--estimate", "1 min", "--", sleeper(10));
        const file = path.join(home, "queue.json");
        const queue = JSON.parse(await readFile(file, "utf8"));
        Object.assign(queue.jobs[0], { status: "running", runnerPid: pid });
        await writeFile(file, JSON.stringify(queue));
        await backlog(home);
        assert.deepEqual((await journalOf(home)).find((entry) => entry.kind === "orphans-requeued").ids, ["left"]);
        assert.equal((await statusOf(home, "left")).status, "done");
      }),
    ));
});

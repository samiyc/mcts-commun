import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { commandOf } from "../node/backlog-commands.js";
import { readSlots, takeSlot, threadBudget, watchMemory } from "../node/machine.js";

const run = promisify(execFile);
const RUNNER = fileURLToPath(new URL("../bin/backlog.js", import.meta.url));
const quiet = { ...process.env, MCTS_HEAT_ALERT: "0", MCTS_SENSORS_URL: "http://127.0.0.1:9/", MCTS_RAM_FLOOR: "0", MCTS_BACKLOG_POLL_MS: "50" };
const backlog = (home, ...args) => run(process.execPath, [RUNNER, "--home", home, ...args], { env: quiet });

describe("the machine's runner (bin/backlog.js) and its slots (node/machine.js), Sami 23/10", () => {
  it("lends the threads lopin does: every core but 3, 18 at most", () => {
    assert.deepEqual([2, 4, 6, 8, 12, 24, 64].map(threadBudget), [1, 2, 3, 5, 9, 18, 18]);
  });

  it("gives threads while they fit in the budget, a big job alone, and forgets dead processes", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "slots-"));
    const one = await takeSlot({ home, id: "a", threads: 6, budget: 18 });
    const two = await takeSlot({ home, id: "b", threads: 12, budget: 18 });
    assert.ok(one && two);
    assert.equal(await takeSlot({ home, id: "c", threads: 1, budget: 18 }), null, "18 fils pris");
    await two.release();
    assert.deepEqual((await readSlots(home)).map((slot) => slot.id), ["a"]);
    // A job asking more than the budget runs once the machine is empty.
    assert.equal(await takeSlot({ home, id: "big", threads: 30, budget: 18 }), null);
    await one.release();
    const big = await takeSlot({ home, id: "big", threads: 30, budget: 18 });
    assert.ok(big);
    await big.release();
    // A slot of a process that has died does not count.
    const ghost = await takeSlot({ home, id: "ghost", threads: 18, budget: 18, pid: 2 ** 22 + 12345 });
    assert.ok(ghost);
    assert.ok(await takeSlot({ home, id: "d", threads: 18, budget: 18 }));
    await rm(home, { recursive: true, force: true });
  });

  it("stops a job under the memory floor, twice in a row", () => {
    let free = 10 * 1024 ** 3;
    let low = null;
    const memory = watchMemory({ everyMs: 1e6, floorGb: 5, onLow: (gb) => (low = gb), read: () => free });
    free = 4 * 1024 ** 3;
    memory.sample();
    assert.equal(low, null);
    memory.sample();
    assert.equal(low, 4);
    memory.stop();
  });

  it("adds a project's night file, each id tagged, the prerequisites too, in the file's folder; the same tag twice is refused", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "backlog-"));
    const folder = await mkdtemp(path.join(os.tmpdir(), "projet-"));
    const file = path.join(folder, "night.json");
    await writeFile(file, JSON.stringify({ jobs: [{ id: "a", command: "echo a", estimate: "1 min" }, { id: "b", command: "echo b", after: ["a"] }] }));
    await backlog(home, "--add-file", file, "--tag", "n1");
    const { jobs } = JSON.parse(await readFile(path.join(home, "queue.json"), "utf8"));
    assert.deepEqual(jobs.map((job) => [job.id, job.cwd, job.after ?? null]), [["a-n1", folder, null], ["b-n1", folder, ["a-n1"]]]);
    await assert.rejects(backlog(home, "--add-file", file, "--tag", "n1"), /existe déjà/);
    await backlog(home, "--add-file", file, "--tag", "n2");
    assert.equal(JSON.parse(await readFile(path.join(home, "queue.json"), "utf8")).jobs.length, 4);
    await rm(home, { recursive: true, force: true });
    await rm(folder, { recursive: true, force: true });
  });

  it("adds a file's jobs as they are with --no-tag, each in its own folder (lopin's queue, 26/10)", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "backlog-"));
    const folder = await mkdtemp(path.join(os.tmpdir(), "projet-"));
    const file = path.join(folder, "night.json");
    await writeFile(file, JSON.stringify({ jobs: [{ id: "DUEL_1", command: "echo 1", cwd: ".." }, { id: "DUEL_2", command: "echo 2", after: ["DUEL_1"], stopIf: [{ after: ["DUEL_1"], below: 0.5 }] }] }));
    await backlog(home, "--add-file", file, "--no-tag");
    const { jobs } = JSON.parse(await readFile(path.join(home, "queue.json"), "utf8"));
    assert.deepEqual(jobs.map((job) => [job.id, job.cwd, job.after ?? null]), [["DUEL_1", path.dirname(folder), null], ["DUEL_2", folder, ["DUEL_1"]]]);
    assert.deepEqual(jobs[1].stopIf, [{ after: ["DUEL_1"], below: 0.5 }]);
    await rm(home, { recursive: true, force: true });
    await rm(folder, { recursive: true, force: true });
  });

  it("starts a dozen jobs at once without losing the queue (Sami, 23/10: fifteen together broke it on Windows)", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "backlog-"));
    const folder = await mkdtemp(path.join(os.tmpdir(), "projet-"));
    const file = path.join(folder, "night.json");
    await writeFile(file, JSON.stringify({ jobs: Array.from({ length: 12 }, (_, i) => ({ id: `j${i}`, command: 'node -e "setTimeout(() => {}, 300)"', estimate: "1 min" })) }));
    await backlog(home, "--add-file", file, "--tag", "x");
    await backlog(home, "--budget", "18");
    const archive = JSON.parse(await readFile(path.join(home, "done", (await readdir(path.join(home, "done")))[0]), "utf8"));
    assert.equal(archive.length, 12);
    assert.ok(archive.every((job) => job.status === "done"));
    await rm(home, { recursive: true, force: true });
    await rm(folder, { recursive: true, force: true });
  });

  it("runs a queue: side by side within the budget, after its prerequisites, each in its folder, archived and logged", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "backlog-"));
    const folder = await mkdtemp(path.join(os.tmpdir(), "projet-"));
    const wait = (ms, word) => `node -e "setTimeout(() => console.log('${word}', process.cwd(), process.env.MCTS_THREADS), ${ms})"`;
    await backlog(home, "--add", "a", "--cwd", folder, "--estimate", "1 min", "--", wait(600, "a"));
    await backlog(home, "--add", "b", "--cwd", folder, "--estimate", "1 min", "--threads", "2", "--", wait(600, "b"));
    await backlog(home, "--add", "c", "--cwd", folder, "--estimate", "1 min", "--after", "a,b", "--", wait(10, "c"));
    await backlog(home, "--add", "bad", "--cwd", folder, "--estimate", "2 min", "--", 'node -e "process.exit(3)"');
    const { stdout: list } = await backlog(home, "--list");
    assert.match(list, /À venir \(4\)/);
    assert.match(list, /\sc\s+1 min\s+après a, b/);
    const started = Date.now();
    await backlog(home, "--budget", "3");
    const archive = JSON.parse(await readFile(path.join(home, "done", (await readdir(path.join(home, "done")))[0]), "utf8"));
    const byId = Object.fromEntries(archive.map((job) => [job.id, job]));
    assert.deepEqual(Object.keys(byId).sort(), ["a", "b", "bad", "c"]);
    assert.equal(byId.bad.status, "failed");
    assert.ok(["a", "b", "c"].every((id) => byId[id].status === "done"));
    // a and b (1 + 2 threads) ran side by side: each started before the other ended. Read in the journal, not on the
    // clock: with the machine's 18 threads busy, the whole run took 3.1 s against 3 (27/10/2026).
    const journal = (await readFile(path.join(home, "journal", (await readdir(path.join(home, "journal")))[0]), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const at = (kind, id) => Date.parse(journal.find((entry) => entry.kind === kind && entry.id === id).at);
    assert.ok(at("job-started", "b") < at("job-ended", "a") && at("job-started", "a") < at("job-ended", "b"), "a et b côte à côte");
    assert.ok(Date.now() - started < 15_000, `${Date.now() - started} ms`);
    const output = await readFile(path.join(home, byId.b.output), "utf8");
    assert.match(output, new RegExp(`b ${folder.replace(/\\/g, "\\\\")} 2`));
    const log = await readFile(path.join(home, "job-log", (await readdir(path.join(home, "job-log")))[0]), "utf8");
    assert.equal(log.trim().split("\n").length, 4);
    assert.deepEqual(JSON.parse(await readFile(path.join(home, "queue.json"), "utf8")).jobs, []);
    await rm(home, { recursive: true, force: true });
    await rm(folder, { recursive: true, force: true });
  });

  it("journals what it does, and traces each job that uses the library (Sami, 26/10: the backlog was a black box)", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "backlog-"));
    const folder = await mkdtemp(path.join(os.tmpdir(), "projet-"));
    const library = new URL("../src/mcts.js", import.meta.url).href;
    await writeFile(path.join(folder, "job.mjs"), `const { search } = await import(${JSON.stringify(library)});\ntry { search({}, {}, { budget: 1 }); } catch {}\n`);
    await backlog(home, "--add", "lib", "--cwd", folder, "--estimate", "1 min", "--", "node job.mjs");
    await backlog(home, "--add", "bad", "--cwd", folder, "--estimate", "1 min", "--", 'node -e "process.exit(2)"');
    await backlog(home);
    const journal = (await readFile(path.join(home, "journal", (await readdir(path.join(home, "journal")))[0]), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const kinds = journal.map((entry) => entry.kind);
    assert.deepEqual([kinds[0], kinds[1], kinds[2], kinds.at(-1)], ["added", "added", "runner-started", "runner-ended"]);
    assert.equal(kinds.filter((kind) => kind === "job-started").length, 2);
    const ended = Object.fromEntries(journal.filter((entry) => entry.kind === "job-ended").map((entry) => [entry.id, entry]));
    assert.equal(ended.lib.status, "done");
    assert.deepEqual([ended.bad.status, ended.bad.code], ["failed", 2]);
    const archive = JSON.parse(await readFile(path.join(home, "done", (await readdir(path.join(home, "done")))[0]), "utf8"));
    const lib = archive.find((job) => job.id === "lib");
    assert.ok(Number.isInteger(lib.childPid));
    assert.match(lib.trace, /^traces[\\/].*_lib\.jsonl$/);
    const trace = (await readFile(path.join(home, lib.trace), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(trace.map(({ scope, kind }) => `${scope}/${kind}`), ["process/start", "search/error", "process/heartbeat", "process/end"]);
    await rm(home, { recursive: true, force: true });
    await rm(folder, { recursive: true, force: true });
  });

  it("answers --help and refuses an option it does not know, without starting a runner (27/10)", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "backlog-"));
    assert.match((await backlog(home, "--help")).stdout, /--add ID --cwd DOSSIER/);
    await assert.rejects(backlog(home, "--lsit"), (error) => error.code === 1 && /option inconnue : --lsit/.test(error.stderr));
    assert.deepEqual(await readdir(home), [], "no runner, no journal");
    await rm(home, { recursive: true, force: true });
  });

  it("keeps the quotes of a command given in several words after -- (27/10: node -e lost its code)", async () => {
    assert.equal(commandOf(["npm run compare -- --plan petit"]), "npm run compare -- --plan petit", "one word: the shell's line");
    assert.equal(commandOf(["npm", "run", "compare", "--", "--plan", "petit"]), "npm run compare -- --plan petit");
    assert.equal(commandOf(["node", "-e", 'console.log("a b")']), 'node -e "console.log(\\"a b\\")"');
    const home = await mkdtemp(path.join(os.tmpdir(), "backlog-"));
    const folder = await mkdtemp(path.join(os.tmpdir(), "projet-"));
    await backlog(home, "--add", "q", "--cwd", folder, "--estimate", "1 min", "--", "node", "-e", "console.log('a  b'.length)");
    await backlog(home);
    const runs = await readdir(path.join(home, "runs"));
    assert.match(await readFile(path.join(home, "runs", runs[0]), "utf8"), /^4/, "the two spaces kept");
    await rm(home, { recursive: true, force: true });
    await rm(folder, { recursive: true, force: true });
  });
});

import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

/**
 * The backlog's command run end to end on a temporary home, shared by the tests of the queue, the runners, the slots and
 * the permanent runner (split on 31/10/2026 so that four files run side by side: one file took 35 s of the 40 s of
 * `npm test`). Never the machine's own `~/.mcts-backlog`.
 */
export const run = promisify(execFile);
export const RUNNER = fileURLToPath(new URL("../../bin/backlog.js", import.meta.url));
/** No heat alert, no sensors, no memory floor, a quick poll: the tests' environment. */
export const quiet = { ...process.env, MCTS_HEAT_ALERT: "0", MCTS_SENSORS_URL: "http://127.0.0.1:9/", MCTS_RAM_FLOOR: "0", MCTS_BACKLOG_POLL_MS: "50" };
export const backlog = (home, ...args) => run(process.execPath, [RUNNER, "--home", home, ...args], { env: quiet });
/** The exit code of a command that may fail on purpose (`--wait`, `--status` of an unknown job). */
export const codeOf = (home, ...args) => backlog(home, ...args).then(
  () => 0,
  (error) => error.code,
);
export const sleeper = (ms) => `node -e "setTimeout(() => {}, ${ms})"`;
export const archiveOf = async (home) => (await Promise.all((await readdir(path.join(home, "done"))).map(async (name) => JSON.parse(await readFile(path.join(home, "done", name), "utf8"))))).flat();
export const statusOf = async (home, id) => JSON.parse((await backlog(home, "--status", id, "--json")).stdout);
/** The journal's entries of a temporary home (one month file). */
export const journalOf = async (home) => (await readFile(path.join(home, "journal", (await readdir(path.join(home, "journal")))[0]), "utf8")).trim().split("\n").map((line) => JSON.parse(line));

/** `work(home, folder)` on a temporary home and a temporary project folder, both removed after. */
export async function scratch(work) {
  const home = await mkdtemp(path.join(os.tmpdir(), "backlog-"));
  const folder = await mkdtemp(path.join(os.tmpdir(), "projet-"));
  try {
    await work(home, folder);
  } finally {
    await rm(home, { recursive: true, force: true, maxRetries: 5 });
    await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  }
}

import path from "node:path";

/**
 * Loaded first in every Node process of a backlog job (`--import`, node/run-job.js; 27/10/2026: the night's jobs,
 * whose computation never yields, opened their trace only when they ended). The trace file is opened before the job's
 * own modules, so its start is written at once and the library's calls beat from the first. npm and npx, which only
 * start the job's script, are left out: they would beat while the job is stuck.
 *
 * By hand: `NODE_OPTIONS=--import=mcts-commun/trace-preload.js MCTS_TRACE=1 npm run …`.
 */
const LAUNCHERS = ["npm-cli.js", "npx-cli.js"];

if (!LAUNCHERS.includes(path.basename(process.argv[1] ?? ""))) {
  const { traceLevel } = await import("../src/trace.js");
  if (traceLevel() !== "off") (await import("./trace-file.js")).traceToFile();
}

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where a command's time goes (30/10/2026: the library reanalysed; Sami wants a gain measured before the queue measures
 * it). `node bench/profile.js [--top N] -- node script.js args…` runs the command under `--cpu-prof`, in a folder of its
 * own, then prints the N functions of most self time (25 by default) and the share by file. The command starts with
 * `node`; its own output goes through. Beside the queue, under `mcts-backlog --slot 1`. For a project:
 * `node ../mcts-commun/bench/profile.js -- node scripts/search-bench.js 2 …`.
 */
const args = process.argv.slice(2);
const at = args.indexOf("--");
const top = args.includes("--top") ? Number(args[args.indexOf("--top") + 1]) : 25;
const command = at >= 0 ? args.slice(at + 1) : [];
if (command.length < 2 || !/^node(\.exe)?$/i.test(path.basename(command[0]))) {
  console.error("usage : node bench/profile.js [--top N] -- node script.js args…");
  process.exit(1);
}
const dir = mkdtempSync(path.join(os.tmpdir(), "mcts-profile-"));
const run = spawnSync(command[0], ["--cpu-prof", `--cpu-prof-dir=${dir}`, ...command.slice(1)], { stdio: "inherit" });
for (const file of readdirSync(dir).filter((name) => name.endsWith(".cpuprofile"))) report(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
rmSync(dir, { recursive: true, force: true });
process.exit(run.status ?? 1);

/** Self time by function (`name  file:line`) and by file, from the profile's samples, in microseconds. */
function selfTimes(profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const byFunction = new Map();
  const byFile = new Map();
  let total = 0;
  profile.samples.forEach((id, i) => {
    const { functionName, url, lineNumber } = byId.get(id).callFrame;
    const file = path.basename(url) || "(native)";
    const delta = profile.timeDeltas[i] ?? 0;
    const key = `${functionName || "(anonymous)"}  ${file}:${lineNumber + 1}`;
    byFunction.set(key, (byFunction.get(key) ?? 0) + delta);
    byFile.set(file, (byFile.get(file) ?? 0) + delta);
    total += delta;
  });
  return { byFunction, byFile, total };
}

function sorted(map) {
  return [...map].sort((a, b) => b[1] - a[1]);
}

function share(value, total) {
  return `${((100 * value) / total).toFixed(1).padStart(5)} %`;
}

function report(profile) {
  const { byFunction, byFile, total } = selfTimes(profile);
  console.log(`\n${Math.round(total / 1000)} ms échantillonnées`);
  console.log(sorted(byFile).slice(0, 8).map(([file, value]) => `${share(value, total).trim()} ${file}`).join("  |  "));
  for (const [key, value] of sorted(byFunction).slice(0, top)) console.log(`${share(value, total)}  ${key}`);
}

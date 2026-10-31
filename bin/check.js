import { spawn } from "node:child_process";

/**
 * `npm run check` (bin/check.js): the lint, the types and the tests, the three started together (31/10/2026: one after
 * the other they took 50 s a commit; the lint and the types are single-threaded and short, the tests take four
 * processes). Each one's output is kept and printed whole when all have ended, in a fixed order, so that a failure
 * reads as before; the exit code is the first non-zero one.
 */
const STEPS = ["lint", "types", "test"];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

/** `npm run <step>`, its output gathered: `{ step, code, output }`. */
function step(name) {
  return new Promise((resolve) => {
    const child = spawn(npm, ["run", name], { shell: process.platform === "win32", env: process.env });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("close", (code) => resolve({ step: name, code: code ?? 1, output: Buffer.concat(chunks).toString("utf8") }));
  });
}

const results = await Promise.all(STEPS.map(step));
for (const { step: name, code, output } of results) {
  const title = code ? `${name} : échec (${code})` : name;
  process.stdout.write(`\n── ${title} ──\n${output}`);
}
process.exit(results.find((one) => one.code)?.code ?? 0);

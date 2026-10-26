#!/usr/bin/env node
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { readBacklog, viewOf } from "../node/backlog-view.js";
import { backlogHome, threadBudget } from "../node/machine.js";
import { tailOf } from "../node/tail.js";

/**
 * `mcts-serve [port]`: serves the current folder on 127.0.0.1, for a project's page (`npm run page`). The page
 * finds the library through `node_modules/mcts-commun` (a link to the sibling folder, read through), so the
 * same files run in Node and in the browser, with no build. A development tool: no listing, nothing outside
 * the folder.
 *
 * A worker does not read the page's import map (23/10/2026, the emergency department's comparison in workers):
 * served JavaScript has its `mcts-commun/` imports pointed at the library's folder, so that a module worker finds
 * it too. The page's import map stays, for anything else.
 *
 * Replays (Sami, 23/10/2026: stored by themselves, out of git like lopin's replays/): `POST /api/replays` with a
 * replay's JSON writes it to the folder's `replays/` (each project's .gitignore leaves it out), named from its
 * `format`, its `savedAt` and a few of its own fields; `GET /api/replays` lists the files there.
 *
 * The machine's backlog (Sami, 26/10/2026: a black box; mcts-commun's own page shows it): `GET /api/backlog` gives
 * node/backlog-view.js's view of `MCTS_BACKLOG_HOME` (~/.mcts-backlog), `GET /api/backlog/tail?id=…&kind=output|trace`
 * the end of a job's output or trace. Read only: the runner may be at work. A request that fails is written to the
 * folder's `logs/serve-YYYY-MM.jsonl` (out of git).
 */
const ROOT = process.cwd();
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4800);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".png": "image/png" };

/** `from "mcts-commun/x.js"` → `from "/node_modules/mcts-commun/src/x.js"` (static and dynamic imports). */
const withLibrary = (code) => code.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])mcts-commun\//g, "$1$2/node_modules/mcts-commun/src/");

async function fileFor(url) {
  const wanted = path.normalize(decodeURIComponent(new URL(url, "http://local").pathname));
  const full = path.join(ROOT, wanted);
  if (!full.startsWith(ROOT)) return null;
  const info = await stat(full).catch(() => null);
  // A folder serves its index.html (joined as a path: "/" + "/index.html" read as a URL named a host, and looped, 26/10).
  if (info?.isDirectory()) return (await stat(path.join(full, "index.html")).catch(() => null))?.isFile() ? path.join(full, "index.html") : null;
  return info?.isFile() ? full : null;
}

const REPLAYS = path.join(ROOT, "replays");
const MAX_REPLAY = 2 * 1024 * 1024;
/** A replay's file name: its kind (the format's first word), its date, and a short slug of what it played. */
function replayName(replay) {
  const kind = String(replay.format ?? "replay").split(/[-/]/)[0].replace(/[^a-z0-9]/gi, "") || "replay";
  const when = String(replay.savedAt ?? new Date().toISOString()).slice(0, 19).replace(/[:T]/g, "-");
  const what = [replay.kitchenId ?? replay.hospital ?? replay.planId, replay.seed].filter((part) => part !== undefined).join("-").replace(/[^a-z0-9-]/gi, "");
  return `${kind}_${when}${what ? `_${what}` : ""}.json`;
}

async function replays(request, response) {
  const send = (status, body) => response.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
  if (request.method === "GET") {
    const { readdir } = await import("node:fs/promises");
    send(200, { files: (await readdir(REPLAYS).catch(() => [])).filter((name) => name.endsWith(".json")).sort().reverse() });
    return;
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > MAX_REPLAY) return send(413, { error: "replay trop gros" });
  }
  let replay;
  try {
    replay = JSON.parse(body);
  } catch {
    return send(400, { error: "pas du JSON" });
  }
  if (!replay || typeof replay.format !== "string") return send(400, { error: "pas un replay (format manquant)" });
  await mkdir(REPLAYS, { recursive: true });
  const name = replayName(replay);
  await writeFile(path.join(REPLAYS, name), JSON.stringify(replay, null, 1));
  send(201, { file: `replays/${name}` });
}

const json = (response, status, body) => response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end(JSON.stringify(body));

async function backlog(url, response) {
  const home = backlogHome();
  const view = viewOf(await readBacklog(home, { budget: threadBudget() }));
  if (url.pathname === "/api/backlog") return json(response, 200, view);
  const id = url.searchParams.get("id");
  const kind = url.searchParams.get("kind") ?? "output";
  const running = view.running.find((job) => job.id === id);
  const finished = view.finished.find((job) => job.id === id);
  const trace = view.traces.find((one) => one.id === id || one.name === id);
  const file = kind === "trace" ? (trace?.file ?? (finished?.trace ? path.join(home, finished.trace) : null)) : (running?.output ?? (finished?.output ? path.join(home, finished.output) : null));
  if (!file) return json(response, 404, { error: `rien pour ${id}` });
  json(response, 200, { file, lines: await tailOf(file, { lines: Number(url.searchParams.get("lines") ?? 400) }) });
}

const LOGS = path.join(ROOT, "logs");
async function logFailure(request, error) {
  const at = new Date();
  await mkdir(LOGS, { recursive: true });
  await appendFile(path.join(LOGS, `serve-${at.toISOString().slice(0, 7)}.jsonl`), `${JSON.stringify({ at: at.toISOString(), method: request.method, url: request.url, message: error.message, stack: error.stack })}\n`);
}

createServer(async (request, response) => {
  try {
    await serve(request, response);
  } catch (error) {
    console.error(`${request.method} ${request.url} : ${error.message}`);
    await logFailure(request, error).catch(() => {});
    if (!response.headersSent) json(response, 500, { error: error.message });
    else response.end();
  }
}).listen(PORT, "127.0.0.1", function announce() {
  // The port taken: PORT, or the one the system chose for 0 (the tests).
  console.log(`http://127.0.0.1:${this.address().port}/web/`);
});

async function serve(request, response) {
  const url = new URL(request.url, "http://local");
  if (url.pathname === "/api/replays" && ["GET", "POST"].includes(request.method)) {
    await replays(request, response);
    return;
  }
  if ((url.pathname === "/api/backlog" || url.pathname === "/api/backlog/tail") && request.method === "GET") {
    await backlog(url, response);
    return;
  }
  const file = await fileFor(request.url);
  if (!file) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("introuvable");
    return;
  }
  response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  const body = await readFile(file);
  response.end(path.extname(file) === ".js" ? withLibrary(body.toString("utf8")) : body);
}

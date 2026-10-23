#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

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
  if (info?.isDirectory()) return fileFor(`${wanted.replaceAll("\\", "/")}/index.html`);
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

createServer(async (request, response) => {
  if (new URL(request.url, "http://local").pathname === "/api/replays" && ["GET", "POST"].includes(request.method)) {
    await replays(request, response);
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
}).listen(PORT, "127.0.0.1", () => console.log(`http://127.0.0.1:${PORT}/web/`));

#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

/**
 * `mcts-serve [port]`: serves the current folder on 127.0.0.1, for a project's page (`npm run page`). The page
 * finds the library through `node_modules/mcts-commun` (a link to the sibling folder, read through), so the
 * same files run in Node and in the browser, with no build. A development tool: no listing, nothing outside
 * the folder.
 */
const ROOT = process.cwd();
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4800);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".png": "image/png" };

async function fileFor(url) {
  const wanted = path.normalize(decodeURIComponent(new URL(url, "http://local").pathname));
  const full = path.join(ROOT, wanted);
  if (!full.startsWith(ROOT)) return null;
  const info = await stat(full).catch(() => null);
  if (info?.isDirectory()) return fileFor(`${wanted.replaceAll("\\", "/")}/index.html`);
  return info?.isFile() ? full : null;
}

createServer(async (request, response) => {
  const file = await fileFor(request.url);
  if (!file) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("introuvable");
    return;
  }
  response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  response.end(await readFile(file));
}).listen(PORT, "127.0.0.1", () => console.log(`http://127.0.0.1:${PORT}/web/`));

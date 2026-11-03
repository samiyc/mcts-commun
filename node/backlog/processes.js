import { execFile } from "node:child_process";
import path from "node:path";
import { alive } from "../machine.js";

/**
 * Which pids are still ours, for the views (Sami, 3/11/2026: « pourquoi il y a deux runners ? »). A runner stopped with
 * the PC writes no `runner-ended`, and Windows gives its number to another process: `alive` then took a svchost for a
 * runner, and the views showed one more, waiting for threads. Runners and slots are node processes, so a pid is checked
 * once against the machine's list of them, and asked again only after it dies. A node process that takes the number is
 * not told apart: the views are wrong as long as it lives, a job's time at most.
 */
const IMAGE = path.basename(process.execPath);
const TASKLIST = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tasklist.exe");
const WINDOWS_ROW = /^"([^"]+)","(\d+)"/;
const UNIX_ROW = /^(\d+) (\S+)/;

/** The row of `tasklist /FO CSV /NH` or of `ps -eo pid=,comm=` as `[image, pid]`, or null. */
function rowOf(line) {
  const windows = WINDOWS_ROW.exec(line);
  if (windows) return [windows[1], Number(windows[2])];
  const unix = UNIX_ROW.exec(line.trim().replace(/\s+/g, " "));
  return unix ? [unix[2], Number(unix[1])] : null;
}

/** The pids of the processes named `image` in a process list, whatever the system's language. Pure. */
export function pidsOfImage(listing, image) {
  const rows = listing.split(/\r?\n/).map(rowOf).filter(Boolean);
  return new Set(rows.filter(([name]) => name.toLowerCase() === image.toLowerCase()).map(([, pid]) => pid));
}

const listing = () =>
  new Promise((resolve) => {
    const [file, args] = process.platform === "win32" ? [TASKLIST, ["/FI", `IMAGENAME eq ${IMAGE}`, "/FO", "CSV", "/NH"]] : ["/bin/ps", ["-eo", "pid=,comm="]];
    execFile(file, args, { timeout: 5_000, windowsHide: true }, (error, stdout) => resolve(error ? null : stdout));
  });

/** The machine's node processes, or null when it cannot tell: a list without this very process is not to be believed. */
export async function nodeProcesses() {
  const text = await listing();
  const pids = text === null ? null : pidsOfImage(text, IMAGE);
  return pids?.has(process.pid) ? pids : null;
}

/**
 * `living(pids)`: those of `pids` alive and node processes, all those alive when the list cannot be had. What a pid is
 * stays known while it lives, so that the TUI's tick starts no process once it has seen them all.
 */
export function createLiving(list = nodeProcesses) {
  const known = new Map();
  return async function living(pids) {
    const up = pids.filter((pid) => alive(pid));
    for (const pid of known.keys()) if (!up.includes(pid)) known.delete(pid);
    const unknown = up.filter((pid) => !known.has(pid));
    const nodes = unknown.length ? await list() : null;
    if (nodes) for (const pid of unknown) known.set(pid, nodes.has(pid));
    return up.filter((pid) => known.get(pid) ?? true);
  };
}

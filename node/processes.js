import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Whether a process of the machine's queue still lives (Sami, 3/11/2026: « pourquoi il y a deux runners ? »). A runner
 * stopped with the PC leaves its number behind, and Windows gives that number to another process: answering from the
 * signal alone took a svchost for a runner. The views showed one more; a `--stay` at logon could have left, a slot kept
 * its threads, a job stayed « running ». Runners and slots are node processes, so a pid must also be one of them.
 *
 * The list costs a process (150 ms), and this is read at every tick: it is kept `FRESH_MS`, and only pids of other
 * processes ask for it. When it cannot be had, the signal alone decides: a stranger taken for a runner costs a line or
 * a few threads, a runner taken for dead would run its jobs twice. A node process that takes the number is not told
 * apart, as long as it lives.
 */
const IMAGE = path.basename(process.execPath);
const TASKLIST = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tasklist.exe");
const FRESH_MS = 30_000;
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

function listing() {
  const [file, args] = process.platform === "win32" ? [TASKLIST, ["/FI", `IMAGENAME eq ${IMAGE}`, "/FO", "CSV", "/NH"]] : ["/bin/ps", ["-eo", "pid=,comm="]];
  try {
    return execFileSync(file, args, { timeout: 5_000, windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** The machine's node processes, or null when it cannot tell: a list without this very process is not to be believed. */
export function nodeProcesses() {
  const text = listing();
  const pids = text === null ? null : pidsOfImage(text, IMAGE);
  return pids?.has(process.pid) ? pids : null;
}

function signalled(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** `alive`, on a list and a clock of one's own. */
export function createAlive(list = nodeProcesses, now = Date.now) {
  const strangers = new Map();
  let nodes = new Set();
  let listedAt = -Infinity;
  let blindUntil = -Infinity;
  const isNode = (pid) => {
    const at = now();
    if (at < blindUntil) return true;
    if (nodes.has(pid) && at - listedAt < FRESH_MS) return true;
    if (at - (strangers.get(pid) ?? -Infinity) < FRESH_MS) return false;
    const listed = list();
    if (!listed) {
      blindUntil = at + FRESH_MS;
      return true;
    }
    nodes = listed;
    listedAt = at;
    if (!listed.has(pid)) strangers.set(pid, at);
    return listed.has(pid);
  };
  return (pid) => signalled(pid) && (pid === process.pid || isNode(pid));
}

/** Is process `pid` still alive, and a node process? */
export const alive = createAlive();

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isFinished } from "../src/schedule.js";
import { withLock } from "./machine.js";

/**
 * The machine's queue (`<home>/queue.json`) and its archive (`<home>/done/YYYY-MM.json`), for the runner and the
 * commands that change them. A change reads the queue, edits it and writes it back holding the queue's lock
 * (`queue.lock`, node/machine.js): one process at a time on the machine (Sami, 26/10/2026: a `--add` from another
 * session while the runner wrote could lose either), and one change at a time in a process (23/10: fifteen jobs
 * starting together wrote it at once, and the runner fell on Windows' EPERM).
 */
export const filesOf = (home) => ({ queue: path.join(home, "queue.json"), done: path.join(home, "done"), runs: path.join(home, "runs"), traces: path.join(home, "traces"), log: path.join(home, "job-log") });

/** A local stamp, "2026-10-26T18:57". */
export const stamp = (date = new Date()) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

// 100 tries of 50 ms: under a loaded machine two runners on one queue saw the 20th try refused (31/10/2026, the tests
// under coverage), and a reader (the TUI, the page, a --list) holds the file a moment on Windows.
const RENAME_TRIES = 100;
let saves = 0;

const readQueue = (files) => readJson(files.queue, { jobs: [] });

/** Writes the queue to its own temporary file, then over the queue. */
async function saveQueue(files, queue, journal) {
  await mkdir(path.dirname(files.queue), { recursive: true });
  saves += 1;
  const tmp = `${files.queue}.${process.pid}.${saves}.tmp`;
  await writeFile(tmp, `${JSON.stringify(queue, null, 2)}\n`);
  await renameRetrying(tmp, files.queue, journal);
}

/** Renames `tmp` over `file`, a few tries: on Windows a file just read may refuse to be replaced a moment (EPERM). */
async function renameRetrying(tmp, file, journal) {
  for (let tries = 0; ; tries += 1) {
    const error = await rename(tmp, file).then(
      () => null,
      (failed) => failed,
    );
    if (!error) return tries > 0 ? journal("queue-retried", { tries }) : undefined;
    if (error.code !== "EPERM") throw error;
    if (tries >= RENAME_TRIES) throw refused(error, tries, journal);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function refused(error, tries, journal) {
  journal("queue-refused", { tries, message: error.message });
  return error;
}

/** A JSON file, read again a moment later when it is caught being replaced; `fallback` when it is missing. */
async function readJson(file, fallback) {
  for (let tries = 0; ; tries += 1) {
    const read = await readFile(file, "utf8")
      .then((text) => JSON.parse(text))
      .then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      );
    if (!read.error) return read.value;
    if (read.error.code === "ENOENT") return fallback;
    if (tries >= RENAME_TRIES) throw read.error;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function readArchive(files) {
  const names = (await readdir(files.done).catch(() => [])).filter((name) => name.endsWith(".json")).sort();
  return (await Promise.all(names.map((name) => readJson(path.join(files.done, name), [])))).flat();
}

/**
 * Adds each finished job to its month's file in `folder`, written whole then renamed into place (Sami, 26/10/2026:
 * with two runners, one read the archive while the other rewrote it, and read half a file).
 */
async function appendArchive(folder, finished, journal) {
  await mkdir(folder, { recursive: true });
  for (const job of finished) {
    const file = path.join(folder, `${job.doneAt.slice(0, 7)}.json`);
    const month = await readJson(file, []);
    saves += 1;
    const tmp = `${file}.${process.pid}.${saves}.tmp`;
    await writeFile(tmp, `${JSON.stringify([...month, job], null, 2)}\n`);
    await renameRetrying(tmp, file, journal);
  }
}

/** The queue of `home`: `read`, `readArchive`, `change(edit)`, `archiveFinished`, `update(id, fields)`, its `files`. */
export function createQueue(home, { journal = () => {} } = {}) {
  const files = filesOf(home);
  let writing = Promise.resolve();

  /** Runs `edit(queue)` on the queue read under the lock; the queue is written back unless it returns `{ keep: true }`. */
  function change(edit) {
    const locked = async () => {
      const queue = await readQueue(files);
      const result = await edit(queue);
      if (!result?.keep) await saveQueue(files, queue, journal);
      return result;
    };
    const done = writing.then(() => withLock(home, locked, "queue"));
    writing = done.catch(() => {});
    return done;
  }

  /** Moves the finished jobs of the queue to their month's archive. */
  const archiveFinished = () =>
    change(async (queue) => {
      const finished = queue.jobs.filter(isFinished);
      if (finished.length === 0) return { keep: true, moved: 0 };
      await appendArchive(files.done, finished, journal);
      queue.jobs = queue.jobs.filter((job) => !isFinished(job));
      return { moved: finished.length };
    });

  /** Merges `fields` into job `id` of the queue. */
  const update = (id, fields) =>
    change((queue) => {
      const job = queue.jobs.find((one) => one.id === id);
      if (job) Object.assign(job, fields);
    });

  return { files, read: () => readQueue(files), readArchive: () => readArchive(files), change, archiveFinished, update };
}

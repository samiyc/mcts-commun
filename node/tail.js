import { open } from "node:fs/promises";

/**
 * The last `lines` lines of `file`, read from its end (at most `bytes`): a job's output or a trace can be large. []
 * when the file is missing. Carriage returns (a progress line redrawn in place) end a line too.
 */
export async function tailOf(file, { lines = 40, bytes = 256 * 1024 } = {}) {
  let handle;
  try {
    handle = await open(file, "r");
  } catch {
    return [];
  }
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const all = buffer.toString("utf8").split(/\r?\n|\r/);
    if (length < size) all.shift();
    while (all.length > 0 && all.at(-1).trim() === "") all.pop();
    return lines > 0 ? all.slice(-lines) : [];
  } finally {
    await handle.close();
  }
}

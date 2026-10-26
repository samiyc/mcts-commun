import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * The machine, for the runner that plays every project's long jobs (bin/backlog.js, Sami 23/10/2026: the scheduler
 * in common). Node only, so it lives in node/, out of src/ that the pages load. What lopin's runner learned, brought here: how many threads the machine lends, the CPU's
 * temperature read from LibreHardwareMonitor, the free memory, and, new, the slots: the jobs running on the
 * machine whatever runner started them, so that two runners never ask for more threads than the machine lends
 * (lopin's runner reads the same file).
 */
const GB = 1024 ** 3;
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const number = (env, names, fallback) => {
  const name = names.find((one) => env[one] !== undefined && env[one] !== "");
  return name ? Number(env[name]) : fallback;
};

/** Where the machine's queue lives: `MCTS_BACKLOG_HOME`, else ~/.mcts-backlog. */
export const backlogHome = (env = process.env) => env.MCTS_BACKLOG_HOME || path.join(os.homedir(), ".mcts-backlog");

/** The threads the machine lends (Sami, 07/10): half the cores up to 6, every core but 3 above, 18 at most. */
export function threadBudget(cores = os.cpus().length) {
  return cores <= 6 ? Math.max(1, Math.floor(cores / 2)) : Math.min(18, cores - 3);
}

// --- The CPU's temperature (lopin's scripts/lib/cli/machine.js) ---

export const SENSORS_URL = "http://127.0.0.1:8085/data.json";
const CPU_SENSOR = /^\/(?:amd|intel)cpu\/\d+\/temperature\//;
const PREFERRED = ["Core (Tctl/Tdie)", "CPU Package", "Core (Tctl)", "Core (Tdie)"];

/** The heat guard's settings: `MCTS_HEAT_ALERT` (0: none), `MCTS_HEAT_RESUME`, `MCTS_HEAT_EVERY` (s), or lopin's names. */
export function heatSettings(env = process.env) {
  return {
    alert: number(env, ["MCTS_HEAT_ALERT", "LOPIN_HEAT_ALERT"], 90),
    resume: number(env, ["MCTS_HEAT_RESUME", "LOPIN_HEAT_RESUME"], 75),
    everyMs: number(env, ["MCTS_HEAT_EVERY", "LOPIN_HEAT_EVERY"], 30) * 1000,
    holds: 2,
    url: env.MCTS_SENSORS_URL || env.LOPIN_SENSORS_URL || SENSORS_URL,
  };
}
const celsiusOf = (text) => Number(String(text).replace(",", ".").replace(/[^\d.-]/g, "") || Number.NaN);
function cpuSensors(node, found = []) {
  if (node.Type === "Temperature" && CPU_SENSOR.test(node.SensorId ?? "")) found.push(node);
  for (const child of node.Children ?? []) cpuSensors(child, found);
  return found;
}
/** The CPU die's temperature in LibreHardwareMonitor's data.json: `{ celsius, sensor }`, or null. */
export function cpuTemperatureOf(data) {
  const sensors = cpuSensors(data).filter((sensor) => Number.isFinite(celsiusOf(sensor.Value)));
  const sensor = PREFERRED.map((name) => sensors.find((one) => one.Text === name)).find(Boolean) ?? sensors[0];
  return sensor ? { celsius: celsiusOf(sensor.Value), sensor: sensor.Text } : null;
}
/** The CPU's temperature from the sensors' server; null when nothing answers. */
export async function readCpuTemperature({ url = heatSettings().url, timeoutMs = 3000 } = {}) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? cpuTemperatureOf(await response.json()) : null;
  } catch {
    return null;
  }
}
/** Reads the temperature every `everyMs`; `onAlert(celsius)` once at `alert` °C `holds` readings in a row. */
export function watchHeat({ settings = heatSettings(), onAlert = /** @type {(celsius: number) => void} */ (() => {}), read = () => readCpuTemperature(settings) } = {}) {
  const seen = [];
  let hot = 0;
  let fired = false;
  const sample = async () => {
    const reading = await read();
    if (!reading) return;
    seen.push(reading.celsius);
    hot = settings.alert > 0 && reading.celsius >= settings.alert ? hot + 1 : 0;
    if (!fired && hot >= settings.holds) {
      fired = true;
      onAlert(reading.celsius);
    }
  };
  sample();
  const timer = setInterval(sample, settings.everyMs);
  return {
    sample,
    stop() {
      clearInterval(timer);
      return seen.length ? { cpuStartC: round(seen[0]), cpuMaxC: round(Math.max(...seen)) } : {};
    },
  };
}
/** Waits until the CPU is back under `resume` °C, at most `maxMinutes`; the last reading. */
export async function waitUntilCool({ settings = heatSettings(), maxMinutes = 30, read = () => readCpuTemperature(settings) } = {}) {
  const end = Date.now() + maxMinutes * 60_000;
  let reading = await read();
  while (!(reading && reading.celsius < settings.resume) && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, settings.everyMs));
    reading = await read();
  }
  return reading;
}

// --- The free memory (lopin's scripts/lib/domain/job-log.js) ---

/** The memory guard's floor in GB: `MCTS_RAM_FLOOR` or `LOPIN_RAM_FLOOR`, 5 by default, 0 turns it off. */
export function memoryFloorGb(env = process.env) {
  const value = number(env, ["MCTS_RAM_FLOOR", "LOPIN_RAM_FLOOR"], 5);
  return Number.isFinite(value) && value >= 0 ? value : 5;
}
/** Samples the free memory every `everyMs`; `onLow(gb)` once under `floorGb` for `holds` samples in a row. */
export function watchMemory({ everyMs = 5_000, floorGb = 0, holds = 2, onLow = /** @type {(gb: number) => void} */ (() => {}), read = () => os.freemem() } = {}) {
  const start = read();
  let low = start;
  let under = 0;
  let fired = false;
  const sample = () => {
    const free = read();
    low = Math.min(low, free);
    under = floorGb > 0 && free < floorGb * GB ? under + 1 : 0;
    if (!fired && under >= holds) {
      fired = true;
      onLow(round(free / GB));
    }
  };
  const timer = setInterval(sample, everyMs);
  return {
    sample,
    stop() {
      clearInterval(timer);
      low = Math.min(low, read());
      return { freeGbStart: round(start / GB), freeGbLow: round(low / GB) };
    },
  };
}

// --- The slots: who runs what on the machine ---

/** Is process `pid` still alive? */
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** The slots file of `home` (slots.json). */
const slotsFile = (home) => path.join(home, "slots.json");
const STALE_LOCK_MS = 30_000;

/** Takes the lock folder `dir` (mkdir is atomic): true, or false when another process holds it. */
async function tryLock(dir) {
  try {
    await mkdir(dir);
    return true;
  } catch (error) {
    // Windows answers EPERM for a folder another process is removing: busy, as when it exists.
    if (error.code === "EPERM") return false;
    if (error.code !== "EEXIST") throw error;
    // A lock held 30 s was left by a process that died (a holder keeps it a few milliseconds): taken over.
    const info = await stat(dir).catch(() => null);
    if (info && Date.now() - info.mtimeMs > STALE_LOCK_MS) await rm(dir, { recursive: true, force: true });
    return false;
  }
}

/**
 * Runs `work` holding the lock `name` of `home`, one process at a time on the machine: "slots" for slots.json,
 * "queue" for the queue (Sami, 26/10/2026: a `--add` from another session while the runner wrote could lose either).
 */
export async function withLock(home, work, name = "slots") {
  const dir = path.join(home, `${name}.lock`);
  await mkdir(home, { recursive: true });
  while (!(await tryLock(dir))) await new Promise((resolve) => setTimeout(resolve, 25));
  try {
    return await work();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The jobs running on the machine, those of dead processes left out: `[{ pid, runner, id, threads, since }]`. */
export async function readSlots(home = backlogHome()) {
  try {
    const { slots } = JSON.parse(await readFile(slotsFile(home), "utf8"));
    return slots.filter((slot) => alive(slot.pid));
  } catch {
    return [];
  }
}

async function writeSlots(home, slots) {
  const file = slotsFile(home);
  await writeFile(`${file}.tmp`, JSON.stringify({ slots }, null, 1));
  await rename(`${file}.tmp`, file);
}

/**
 * Takes `threads` of the machine's `budget` for job `id`, if they are free now: a slot `{ release() }`, or null.
 * A job asking more than the whole budget runs alone.
 */
export async function takeSlot({ home = backlogHome(), id, threads, budget = threadBudget(), runner = "mcts-backlog", pid = process.pid }) {
  return withLock(home, async () => {
    const slots = await readSlots(home);
    const used = slots.reduce((sum, slot) => sum + slot.threads, 0);
    if (slots.length > 0 && used + threads > budget) return null;
    const mine = { pid, runner, id, threads, since: new Date().toISOString() };
    await writeSlots(home, [...slots, mine]);
    return { release: () => withLock(home, () => dropSlot(home, pid, id)) };
  });
}

/** Gives back the slot of job `id` taken by process `pid`. */
async function dropSlot(home, pid, id) {
  await writeSlots(home, (await readSlots(home)).filter((slot) => !(slot.pid === pid && slot.id === id)));
}

/**
 * Waits for `threads` free threads (checking every `everyMs`), then takes them; `onWait(slots)` once while it waits.
 *
 * @param {{ everyMs?: number, onWait?: (slots: object[]) => void, home?: string, id: string, threads: number, budget?: number, runner?: string, pid?: number }} options
 */
export async function waitForSlot({ everyMs = 5_000, onWait = () => {}, ...asked }) {
  let told = false;
  for (;;) {
    const slot = await takeSlot(asked);
    if (slot) return slot;
    if (!told) {
      told = true;
      onWait(await readSlots(asked.home));
    }
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

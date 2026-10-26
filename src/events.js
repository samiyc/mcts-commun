import { trace } from "./trace.js";

/**
 * A discrete-event queue: what happens next, by time. Two events at the same time come out in the order they
 * were scheduled, so a simulation replays the same from the same seed. A binary heap: scheduling and taking
 * the next cost log n.
 *
 * @returns {{ now: number, size: number, schedule(at: number, event: any): void, next(): { at, event } | null, peek(): { at, event } | null, clone(keep?: (event: any) => boolean): ReturnType<typeof createEvents> }}
 */
export function createEvents(start = 0) {
  const heap = createHeap();
  let order = 0;
  let now = start;
  return {
    get now() {
      return now;
    },
    get size() {
      return heap.entries.length;
    },
    /** Schedules `event` at `at`, never before the present. */
    schedule(at, event) {
      // A time that is not a number is refused as one in the past.
      if (Number.isNaN(Number(at)) || at < now) {
        trace("events", "error", { message: "événement dans le passé", at, now });
        throw new Error(`événement dans le passé : ${at} < ${now}`);
      }
      heap.push({ at, order: order++, event });
    },
    /** The next event, the clock moved to it; null once none is left. */
    next() {
      const top = heap.pop();
      if (!top) return null;
      now = top.at;
      return { at: top.at, event: top.event };
    },
    /** The next event without taking it, or null. */
    peek() {
      const top = heap.entries[0];
      return top ? { at: top.at, event: top.event } : null;
    },
    /**
     * A copy of the queue at the same clock, keeping the events `keep(event)` accepts, in the same order. The
     * events themselves are shared: schedule plain values (ids, not the objects they name) to clone safely.
     */
    clone(keep = () => true) {
      const copy = createEvents(now);
      for (const entry of [...heap.entries].sort((a, b) => (before(a, b) ? -1 : 1))) if (keep(entry.event)) copy.schedule(entry.at, entry.event);
      return copy;
    },
  };
}

const before = (a, b) => a.at < b.at || (a.at === b.at && a.order < b.order);

/** The binary heap under the queue: `push`, `pop` (the earliest, or undefined), its `entries`. */
function createHeap() {
  const entries = [];
  const swap = (i, j) => ([entries[i], entries[j]] = [entries[j], entries[i]]);
  const up = (index) => {
    for (let i = index; i > 0 && before(entries[i], entries[(i - 1) >> 1]); i = (i - 1) >> 1) swap(i, (i - 1) >> 1);
  };
  const down = (index) => {
    let i = index;
    for (;;) {
      const left = 2 * i + 1;
      const smaller = left + 1 < entries.length && before(entries[left + 1], entries[left]) ? left + 1 : left;
      if (smaller >= entries.length || !before(entries[smaller], entries[i])) return;
      swap(i, smaller);
      i = smaller;
    }
  };
  return {
    entries,
    push(entry) {
      entries.push(entry);
      up(entries.length - 1);
    },
    pop() {
      if (entries.length === 0) return undefined;
      const top = entries[0];
      const last = entries.pop();
      if (entries.length > 0) {
        entries[0] = last;
        down(0);
      }
      return top;
    },
  };
}

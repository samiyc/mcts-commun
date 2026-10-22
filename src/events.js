/**
 * A discrete-event queue: what happens next, by time. Two events at the same time come out in the order they
 * were scheduled, so a simulation replays the same from the same seed. A binary heap: scheduling and taking
 * the next cost log n.
 *
 * @returns {{ now: number, size: number, schedule(at: number, event: any): void, next(): { at, event } | null, peek(): { at, event } | null }}
 */
export function createEvents(start = 0) {
  const heap = [];
  let order = 0;
  let now = start;
  const before = (a, b) => a.at < b.at || (a.at === b.at && a.order < b.order);
  const swap = (i, j) => ([heap[i], heap[j]] = [heap[j], heap[i]]);

  function up(index) {
    for (let i = index; i > 0 && before(heap[i], heap[(i - 1) >> 1]); i = (i - 1) >> 1) swap(i, (i - 1) >> 1);
  }

  function down(index) {
    let i = index;
    for (;;) {
      const left = 2 * i + 1;
      const smaller = left + 1 < heap.length && before(heap[left + 1], heap[left]) ? left + 1 : left;
      if (smaller >= heap.length || !before(heap[smaller], heap[i])) return;
      swap(i, smaller);
      i = smaller;
    }
  }

  return {
    get now() {
      return now;
    },
    get size() {
      return heap.length;
    },
    /** Schedules `event` at `at`, never before the present. */
    schedule(at, event) {
      if (!(at >= now)) throw new Error(`événement dans le passé : ${at} < ${now}`);
      heap.push({ at, order: order++, event });
      up(heap.length - 1);
    },
    /** The next event, the clock moved to it; null once none is left. */
    next() {
      if (heap.length === 0) return null;
      const top = heap[0];
      const last = heap.pop();
      if (heap.length > 0) {
        heap[0] = last;
        down(0);
      }
      now = top.at;
      return { at: top.at, event: top.event };
    },
    /** The next event without taking it, or null. */
    peek() {
      return heap.length ? { at: heap[0].at, event: heap[0].event } : null;
    },
  };
}

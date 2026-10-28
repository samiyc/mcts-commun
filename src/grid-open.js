/**
 * A*'s open list (src/grid.js): a binary heap of nodes by `f`, then by the order they were pushed, the order
 * `createEvents` gives equal times (src/events.js). Its own, not the event queue (28/10/2026: the warehouse's profile,
 * an entry and a result object a node): a node carries its `f` and `order`, nothing else is allocated.
 */
export function createOpen() {
  const nodes = [];
  let order = 0;
  const before = (a, b) => a.f < b.f || (a.f === b.f && a.order < b.order);
  return {
    /** Pushes `node` at `f`. */
    push(f, node) {
      node.f = f;
      node.order = order++;
      nodes.push(node);
      for (let i = nodes.length - 1; i > 0; ) {
        const parent = (i - 1) >> 1;
        if (!before(nodes[i], nodes[parent])) break;
        [nodes[i], nodes[parent]] = [nodes[parent], nodes[i]];
        i = parent;
      }
    },
    /** The node of least `f`, the first pushed between equals; null once none is left. */
    pop() {
      if (nodes.length === 0) return null;
      const top = nodes[0];
      const last = nodes.pop();
      if (nodes.length > 0) {
        nodes[0] = last;
        sink(nodes, before);
      }
      return top;
    },
  };
}

function sink(nodes, before) {
  for (let i = 0; ; ) {
    const left = 2 * i + 1;
    const smaller = left + 1 < nodes.length && before(nodes[left + 1], nodes[left]) ? left + 1 : left;
    if (smaller >= nodes.length || !before(nodes[smaller], nodes[i])) return;
    [nodes[i], nodes[smaller]] = [nodes[smaller], nodes[i]];
    i = smaller;
  }
}

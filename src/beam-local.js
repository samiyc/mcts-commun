/**
 * The full sort of a beam's children for local beams (src/beam.js, `group`; codingame 29/10/2026: Hypersonic v4's
 * `pruneLocal`, which sorts the children by score, then keeps at most k a cell). In place on `order`, allocating
 * nothing: a quicksort, insertion below 16. The order is total (the better score first, the lower index between
 * equals), so its result is the stable sort's that Hypersonic's `order.sort((a, b) => score[b] - score[a])` gives.
 */

const SMALL = 16;

/** Child `a` before child `b`: the better score, the lower index between equals. */
const before = (score, a, b) => score[a] > score[b] || (score[a] === score[b] && a < b);

function insertionSort(order, score, lo, hi) {
  for (let i = lo + 1; i <= hi; i += 1) {
    const n = order[i];
    let j = i - 1;
    while (j >= lo && before(score, n, order[j])) {
      order[j + 1] = order[j];
      j -= 1;
    }
    order[j + 1] = n;
  }
}

/** Hoare's partition of `order[lo..hi]` around its middle child, by `before`: `bounds` where it split. */
function split({ order, children, bounds }, lo, hi) {
  const score = children.score;
  const pivot = order[(lo + hi) >> 1];
  let i = lo;
  let j = hi;
  while (i <= j) {
    while (before(score, order[i], pivot)) i += 1;
    while (before(score, pivot, order[j])) j -= 1;
    if (i > j) break;
    const swap = order[i];
    order[i++] = order[j];
    order[j--] = swap;
  }
  bounds.i = i;
  bounds.j = j;
}

/** Sorts `order[lo..hi]`: the smaller side by recursion, the larger by the loop, so the depth stays a logarithm. */
function sortRange(beam, lo, hi) {
  while (hi - lo > SMALL) {
    split(beam, lo, hi);
    const { i, j } = beam.bounds;
    if (j - lo < hi - i) {
      sortRange(beam, lo, j);
      lo = i;
    } else {
      sortRange(beam, i, hi);
      hi = j;
    }
  }
  insertionSort(beam.order, beam.children.score, lo, hi);
}

/** The `n` children of the beam in `order`, the best first. */
export const sortBest = (beam, n) => sortRange(beam, 0, n - 1);

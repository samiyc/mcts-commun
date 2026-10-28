/**
 * Seeded PRNG (mulberry32), the one Lopin uses (src/core/random.js). Every random draw of a project goes
 * through here, so a scenario or a search replays from its seed.
 *
 * Its state lives in a Uint32Array, not a variable (29/10/2026, for CodinGame's 50 ms turns): a whole number past
 * 2^30 in a variable is a heap number, one more allocated at every draw, and 4.5 million draws ran the garbage
 * collector 104 times. The same draws as before.
 */
export function createRng(seed) {
  const cell = Uint32Array.of(seed >>> 0);
  const next = () => {
    cell[0] += 0x6d2b79f5;
    let t = cell[0];
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  const rng = {
    next,
    int,
    /** In-place Fisher-Yates; returns the array for chaining. */
    shuffle(array) {
      for (let i = array.length - 1; i > 0; i -= 1) {
        const j = int(i + 1);
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    },
    /** A standard normal draw (Box-Muller). */
    normal() {
      const u = 1 - next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    clone() {
      const copy = createRng(0);
      copy.setState(cell[0]);
      return copy;
    },
    getState: () => cell[0],
    setState: (s) => {
      cell[0] = s >>> 0;
    },
  };
  return rng;
}

/** A stream of its own for `index` under `seed` (a task, a kind of event), so that one stream's draws leave the others alone. */
export function streamOf(seed, index) {
  return createRng((Math.imul(seed, 0x9e3779b1) + index * 0x85ebca6b) >>> 0);
}

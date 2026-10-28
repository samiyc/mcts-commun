/**
 * States reserved once, for searches that must allocate nothing during a turn (codingame, 28/10/2026: on CodinGame,
 * a turn of objects let the garbage collector push turns to 45-72 ms of 75, six times fewer plans than at home).
 * A state is a view of one typed buffer, `size` numbers long, copied with `set`. Hypersonic's layers, made generic.
 */

/**
 * `capacity` states of `size` numbers in one `Type` buffer: `states[i]` its views, `take()` the next one (null when
 * full), `clear()` all of them free again. The views are made here, once: taking and clearing allocate nothing.
 *
 * @param {number} size
 * @param {number} capacity
 * @param {Uint8ArrayConstructor | Int8ArrayConstructor | Uint16ArrayConstructor | Int16ArrayConstructor | Int32ArrayConstructor | Float32ArrayConstructor | Float64ArrayConstructor} [Type]
 */
export function createStatePool(size, capacity, Type = Uint8Array) {
  const buffer = new Type(size * capacity);
  const states = Array.from({ length: capacity }, (_, i) => buffer.subarray(i * size, (i + 1) * size));
  const pool = {
    buffer,
    states,
    size,
    capacity,
    count: 0,
    take() {
      return pool.count < capacity ? states[pool.count++] : null;
    },
    clear() {
      pool.count = 0;
    },
  };
  return pool;
}

/** State `from` copied into `to`, in place. */
export function copyState(to, from) {
  to.set(from);
  return to;
}

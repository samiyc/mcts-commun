/**
 * Toy problems the tests search: small enough to know the answer, each showing one thing a `Problem` does.
 */

/** Nim: take 1 or 2 from the pile, the one who takes the last wins. Nothing hidden; two actors. */
export const nim = {
  sample: (state) => ({ ...state }),
  actor: (world) => world.toMove,
  moves: (world) => [1, 2].filter((take) => take <= world.pile),
  key: (take) => String(take),
  play: (world, take) => ({ pile: world.pile - take, toMove: world.toMove === "A" ? "B" : "A", last: world.toMove }),
  over: (world) => world.pile === 0,
  rollout(world, rng) {
    let end = world;
    while (!this.over(end)) end = this.play(end, Math.min(end.pile, 1 + rng.int(2)));
    return end;
  },
  score: (world, actor) => (world.last === actor ? 1 : 0),
};

/** Two doors, the prize behind A seven times in ten: the search only sees the worlds it draws. */
export const doors = {
  sample: (state, rng) => ({ prize: rng.next() < 0.7 ? "A" : "B", opened: null }),
  actor: () => "me",
  moves: () => ["A", "B"],
  key: (door) => door,
  play: (world, door) => ({ ...world, opened: door }),
  over: (world) => world.opened !== null,
  rollout: (world) => world,
  score: (world) => (world.opened === world.prize ? 1 : 0),
};

/**
 * Two jobs on one machine, lengths hidden (drawn around their estimate), one due at 60: the search orders
 * them to keep the due time. The scheduler's problem in miniature.
 */
export const twoJobs = {
  sample: (state, rng) => ({ ...state, lengths: { short: 20 + 10 * rng.next(), long: 50 + 20 * rng.next() }, clock: 0, done: [] }),
  actor: () => "runner",
  moves: (world) => ["short", "long"].filter((id) => !world.done.includes(id)),
  key: (id) => id,
  play: (world, id) => {
    const clock = world.clock + world.lengths[id];
    return { ...world, clock, done: [...world.done, id], ends: { ...world.ends, [id]: clock } };
  },
  over: (world) => world.done.length === 2,
  rollout(world) {
    let end = world;
    while (!this.over(end)) end = this.play(end, this.moves(end)[0]);
    return end;
  },
  score: (world) => (world.ends[world.due.id] <= world.due.at ? 1 : 0),
};

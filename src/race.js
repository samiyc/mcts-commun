import { normalQuantile, paired } from "./measure.js";

/**
 * A race of configurations (Sami, 12/11/2026; F-race and irace, Birattari and López-Ibáñez): every variant still in
 * the race plays the same seeds, batch after batch, and a variant drops out as soon as the best one beats it, paired
 * over the seeds they share, with an interval that shares alpha among the comparisons and among the looks the race
 * may take (Bonferroni). Where a series of 1 000 games per variant plays them all, a variant already beaten stops
 * early and the budget goes to the close ones.
 *
 * The looks count (12/11/2026, 300 seeded races of 1 000 seeds by batches of 50): with alpha 0.05 at each look, two
 * equal variants lost one in 42 % of the races; shared among the 20 looks, in 4.3 %. A variant at 40 % against one at
 * 60 % still stops after 134 seeds on average, where a fixed series plays 1 000; at 50 % against 55 %, the race tells
 * them apart in a third of the races only, and saves little (1 706 seeds of 2 000).
 *
 * A race only rejects (lopin's lesson: a quick screen never promotes): the variants left at the end are not proven
 * better than the reference, they are those it could not tell apart. One left is confirmed by its own series, as any
 * other gain. The driver that sends the batches to the queue is node/race/ (`mcts-race`, docs/course.md).
 *
 * @typedef {Record<string, Record<string, number>>} RaceResults  variant → seed → score
 * @typedef {{ minSeeds?: number, alpha?: number, looks?: number, maximize?: boolean }} RaceRule
 * @typedef {{ variant: string, mean: number }} Standing
 * @typedef {{ variant: string, mean: number, gap: { n: number, mean: number, low: number, high: number } }} Dropped
 */

/** The seeds every variant of `alive` has played, in numeric order. */
export function commonSeeds(results, alive) {
  if (!alive.length) return [];
  const [first, ...rest] = alive.map((variant) => Object.keys(results[variant] ?? {}));
  const shared = first.filter((seed) => rest.every((seeds) => seeds.includes(seed)));
  return shared.sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

const RULE = { minSeeds: 30, alpha: 0.05, looks: 1, maximize: true };
const scoresOf = (results, variant, seeds) => seeds.map((seed) => results[variant][seed]);
const meanOf = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

/**
 * One look at the race: the variants of `alive` ranked by their mean over the seeds they share, the best first, and
 * those the best beats, dropped. Nothing drops before `minSeeds` seeds (30), nor with a single variant left. A score
 * is the more the better, unless `maximize` is false (a cost, a wait). `alpha` (0.05) is the race's whole risk of
 * dropping a variant as good as the best: shared among the `looks` it may take (the batches, 1 by default) and the
 * comparisons of each look.
 * @param {RaceResults} results
 * @param {string[]} alive
 * @param {RaceRule} [rule]
 * @returns {{ seeds: number, standings: Standing[], best: string | null, dropped: Dropped[], alive: string[] }}
 */
export function raceStep(results, alive, rule = {}) {
  const { minSeeds, alpha, looks, maximize } = { ...RULE, ...rule };
  const seeds = commonSeeds(results, alive);
  const standings = standingsOf(results, alive, seeds, maximize);
  const best = standings[0]?.variant ?? null;
  if (alive.length < 2 || seeds.length < minSeeds) return { seeds: seeds.length, standings, best, dropped: [], alive: [...alive] };
  const z = normalQuantile(1 - alpha / (looks * (alive.length - 1)));
  const dropped = droppedOf({ results, seeds, standings, maximize }, z);
  const out = new Set(dropped.map((one) => one.variant));
  return { seeds: seeds.length, standings, best, dropped, alive: alive.filter((variant) => !out.has(variant)) };
}

/** The variants by their mean over `seeds`, the best first; equal means by name. */
function standingsOf(results, alive, seeds, maximize) {
  const sign = maximize ? 1 : -1;
  const standings = alive.map((variant) => ({ variant, mean: meanOf(scoresOf(results, variant, seeds)) }));
  return standings.sort((a, b) => sign * (b.mean - a.mean) || a.variant.localeCompare(b.variant));
}

/** The variants after the first that it beats, paired over `seeds` with an interval of `z`. */
function droppedOf({ results, seeds, standings, maximize }, z) {
  const bestScores = scoresOf(results, standings[0].variant, seeds);
  return standings.slice(1).flatMap(({ variant, mean }) => {
    const gap = paired(scoresOf(results, variant, seeds), bestScores, z);
    const beaten = maximize ? gap.high < 0 : gap.low > 0;
    return beaten ? [{ variant, mean, gap: { n: gap.n, mean: gap.mean, low: gap.low, high: gap.high } }] : [];
  });
}

/**
 * The seeds of the next batch, `{ from, count }`, or null when the race has played `maxSeeds` (it ends with the
 * variants left). Seeds run from `first` on, every variant alive playing the same.
 */
export function nextBatch({ played, batch, maxSeeds, first = 1 }) {
  const count = Math.min(batch, maxSeeds - played);
  return count > 0 ? { from: first + played, count } : null;
}

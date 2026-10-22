/**
 * Measures, as Lopin's duels taught them: a rate with its Wilson interval, and two rules compared by pairs
 * on the same scenarios, which removes the scenarios' own noise from the gap.
 */
const Z95 = 1.96;

/** A share of wins with its Wilson interval (95 % by default): `{ rate, low, high }`. */
export function wilson(wins, games, z = Z95) {
  if (games === 0) return { rate: 0, low: 0, high: 1 };
  const rate = wins / games;
  const z2 = z * z;
  const centre = (rate + z2 / (2 * games)) / (1 + z2 / games);
  const margin = (z / (1 + z2 / games)) * Math.sqrt((rate * (1 - rate)) / games + z2 / (4 * games * games));
  return { rate, low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

/**
 * Rule A against rule B, scenario by scenario (`scoresA[i]` and `scoresB[i]` on the same scenario): the mean
 * of the differences A − B with its 95 % interval, and the scenarios A won, tied and lost.
 * @returns {{ n: number, mean: number, low: number, high: number, wins: number, ties: number, losses: number }}
 */
export function paired(scoresA, scoresB, z = Z95) {
  if (scoresA.length !== scoresB.length) throw new Error(`paires inégales : ${scoresA.length} et ${scoresB.length}`);
  const gaps = scoresA.map((score, i) => score - scoresB[i]);
  const n = gaps.length;
  const mean = n ? gaps.reduce((sum, gap) => sum + gap, 0) / n : 0;
  const variance = n > 1 ? gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / (n - 1) : 0;
  const margin = n ? z * Math.sqrt(variance / n) : 0;
  return {
    n,
    mean,
    low: mean - margin,
    high: mean + margin,
    wins: gaps.filter((gap) => gap > 0).length,
    ties: gaps.filter((gap) => gap === 0).length,
    losses: gaps.filter((gap) => gap < 0).length,
  };
}

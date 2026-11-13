/**
 * CMA-ES's settings for `genes` numbers, as Hansen gives them ("The CMA Evolution Strategy: A Tutorial", 2016, table 1):
 * nothing to tune but the population, and that only when the landscape has many bumps (a bigger one searches wider).
 */
export function settingsOf(genes, population = 4 + Math.floor(3 * Math.log(genes))) {
  if (!(Number.isInteger(genes) && genes >= 1)) throw new Error(`cmaes : genes vaut un entier d'au moins 1, pas ${genes}`);
  if (!(Number.isInteger(population) && population >= 2)) throw new Error(`cmaes : population vaut un entier d'au moins 2, pas ${population}`);
  const n = genes;
  const mu = Math.floor(population / 2);
  const raw = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const total = raw.reduce((sum, w) => sum + w, 0);
  const weights = Float64Array.from(raw, (w) => w / total);
  const mueff = 1 / weights.reduce((sum, w) => sum + w * w, 0);
  const cs = (mueff + 2) / (n + mueff + 5);
  const c1 = 2 / ((n + 1.3) ** 2 + mueff);
  const cmu = Math.min(1 - c1, (2 * (mueff - 2 + 1 / mueff)) / ((n + 2) ** 2 + mueff));
  return {
    n,
    lambda: population,
    mu,
    weights,
    mueff,
    cs,
    ds: 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs,
    cc: (4 + mueff / n) / (n + 4 + (2 * mueff) / n),
    c1,
    cmu,
    chiN: Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n)),
    // The decomposition costs n³: redone every few generations, as the tutorial advises.
    eigenEvery: Math.max(1, Math.floor(population / (c1 + cmu) / n / 10)),
  };
}

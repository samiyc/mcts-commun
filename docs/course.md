# La course aux configurations (`mcts-race`)

Sami, 12/11/2026 : « course aux config et optimisation bayésienne, c'est utilisable pour booster la backlog ? ». La
course n'accélère pas la file : elle **lui envoie moins de parties**. Elle joue toutes les variantes sur les mêmes
graines, lot après lot, et écarte une variante dès que la meilleure la bat. Le budget va aux variantes encore proches.
C'est le geste de F-race et d'irace (Birattari, López-Ibáñez), et le SPRT de `measure` étendu à N variantes.

Le cœur est pur et testé (`src/race.js`, `raceStep`), le pilote parle à la file (`node/race/race.js`, `bin/race.js`).

## Ce qu'elle promet, et ce qu'elle ne promet pas

- **Elle écarte, elle ne promeut pas** (la leçon de lopin) : les variantes qui restent à la fin sont celles qu'elle n'a
  pas su départager de la meilleure, pas des gains prouvés. Une gagnante se confirme par sa propre série, comme
  aujourd'hui.
- **Son risque est tenu sur toute la course** : `alpha` (0,05) se partage entre les regards (un par lot, `maxSeeds /
  batch`) et les comparaisons de chaque regard (Bonferroni). Sur 300 courses simulées de 1 000 graines par lots de 50,
  deux variantes égales en ont perdu une dans 42 % des courses avec 0,05 à chaque regard, et dans **4,3 %** une fois
  le risque partagé.
- **Ce qu'elle économise dépend des écarts** (les mêmes simulations, deux variantes, 1 000 graines au plus chacune) :

| Les variantes | Graines jouées en tout | Une série fixe | La meilleure écartée à tort |
|---|---|---|---|
| 60 % contre 40 % | 268 | 2 000 | 0 % |
| 55 % contre 50 % | 1 706 | 2 000 | 0,3 % |
| égales | 1 944 | 2 000 | 2,3 % (l'une ou l'autre : 4,3 %) |
| huit : une à 55 %, trois à 50 %, quatre à 40 % | 7 812 | 8 000 | 0 % |

  Elle rapporte beaucoup quand des variantes sont **nettement** moins bonnes : un crible de dix idées dont la moitié
  sont mauvaises. Elle rapporte peu quand toutes se tiennent à quelques points : il faut alors plus de graines de toute
  façon. Des lots plus courts écartent plus tôt, mais multiplient les regards, donc élargissent l'intervalle.
- **Les graines appariées sont sa force** : si la graine fixe tout le hasard de la partie (la carte, les tirages, la
  place), deux variantes qui jouent la même graine ne diffèrent que par leurs décisions, et l'écart se lit bien plus
  vite (le test de `tests/race/race.test.js` le montre : une variante à 70 % contre une à 75 % y tombe en 100 graines).

## Le fichier d'une course

Un JSON dans le dépôt du projet, par exemple `races/hyp-v11.json` :

```json
{
  "id": "hyp-v11-rampes",
  "command": "node tools/arena/race.js --variant {variant} --from {from} --count {count} --out {out}",
  "variants": ["v10", "rampe-a", "rampe-b", "rampe-c"],
  "batch": 50,
  "maxSeeds": 1000,
  "threads": 3,
  "estimate": "12 min"
}
```

| Champ | Par défaut | Ce qu'il dit |
|---|---|---|
| `id`, `variants` | (requis) | des lettres, chiffres, `.`, `-` ou `_` ; deux variantes au moins. La référence est une variante comme les autres |
| `command` | (requis) | lancée dans `cwd` ; `{variant}`, `{from}`, `{count}` et `{out}` y sont remplacés |
| `cwd` | `.` | le dossier du job, lu depuis celui du fichier |
| `batch`, `maxSeeds`, `firstSeed` | 50, 1 000, 1 | les graines `firstSeed` à `firstSeed + maxSeeds − 1`, par lots de `batch` |
| `minSeeds` | 50 | aucune variante n'est écartée avant |
| `alpha` | 0,05 | le risque de toute la course d'écarter une variante aussi bonne que la meilleure |
| `maximize` | `true` | `false` quand le score est un coût (une attente, un temps) |
| `threads`, `estimate`, `priority` | 1, « 15 min », — | ceux des jobs, comme `mcts-backlog --add` |

**Ce que la commande doit faire** : jouer la variante sur les graines `from` à `from + count − 1` et écrire dans `out`
(un chemin relatif à `cwd`, sans espace) une ligne JSON par graine : `{"seed": 12, "score": 1}`. Le score est ce que
le projet mesure déjà : 1, 0,5 ou 0 pour une partie, un rang, une attente moyenne… Une ligne illisible arrête la
course en disant où.

## La lancer

```
npx mcts-race races/hyp-v11.json            un pas : juge les graines jouées, écarte, envoie le lot suivant
npx mcts-race races/hyp-v11.json --follow   jusqu'au bout, en attendant chaque lot (un processus à laisser tourner)
```

Chaque pas se relance sans risque : l'état de la course est dans `races/<id>/race.json` (les variantes en course,
les écartées, quand et de combien, les lots envoyés), les résultats dans `races/<id>/<variante>/<from>.jsonl`. Un job
d'un lot qui échoue arrête la course (code 1) : `mcts-backlog --retry` le relance sous `<id>-r1`, et le pas suivant le
lit. À la fin, `decided` (une variante reste) ou `budget` (plusieurs, à départager par leur propre série).

Les jobs s'appellent `race-<id>-<variante>-<from>` : la page et `--list` les montrent avec les autres, un lot à la fois.

## Ce qui viendrait ensuite

- **L'optimisation bayésienne** proposerait les variantes (des réglages continus), la course les jugerait : après
  CMA-ES (`docs/algorithmes.md` § 5).
- **Un premier client** : un crible de codingame (rampes, poids de la note) ou les réglages de feux. À mesurer sur une
  vraie série : ce qu'elle a joué contre ce qu'une série fixe aurait joué, et le même vainqueur.

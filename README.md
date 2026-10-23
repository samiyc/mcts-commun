# mcts-commun

La bibliothèque commune des projets `mcts-*` : la recherche (MCTS, ISMCTS), la simulation à événements
discrets, l'ordonnancement, la grille et la mesure. Elle ne connaît aucun des thèmes ; chaque projet lui
décrit son problème.

Statut (22/10/2026) : le tirage reproductible (`src/random.js`) et un premier jet de la recherche
(`src/mcts.js`, testé sur Nim et sur deux portes) sont là. Le module `schedule` arrive de Lopin
(`src/schedule/`, l'ordonnanceur de sa file de nuit) au début des urgences ; `mcts` servira d'abord au
planificateur de cette même file, puis aux urgences.

## Les projets

| Dépôt | Ce qu'il fait | Les modules qu'il prend |
|---|---|---|
| [`lopin`](https://github.com/samiyc/lopin) | le jeu de cartes où l'ISMCTS a été construit, et l'ordonnanceur de ses calculs de nuit | `schedule`, peut-être `mcts` un jour |
| `mcts-urgences` | l'organisation des urgences d'un hôpital en crise | `random`, `events`, `schedule`, `mcts`, `measure`, puis `grid` |
| `mcts-entrepot` | des robots d'entrepôt et un cariste | `random`, `events`, `mcts`, `grid`, `measure` |
| `mcts-cuisine` | une cuisine à la *Overcooked*, un cuisinier et des robots | les mêmes que l'entrepôt |

La feuille de route : [`docs/ismcts-ailleurs/feuille-de-route.md`](https://github.com/samiyc/lopin/blob/main/docs/ismcts-ailleurs/feuille-de-route.md)
dans Lopin.

## Les modules

| Module | Ce qu'il contient | État |
|---|---|---|
| `random` | le tirage reproductible, à partir d'une graine (mulberry32, celui de Lopin) | fait |
| `events` | la simulation à événements discrets : une file d'événements datés | fait |
| `schedule` | l'ordre d'une file de jobs : les prérequis, les échéances, les priorités, la règle de Smith (celui de Lopin, validé le 23/10) | fait |
| `machine` (`node/`, Node seulement) | les fils que la machine prête, la garde thermique, la garde mémoire, les créneaux partagés entre lanceurs | fait |
| `mcts` | la recherche : le tirage d'un scénario, la liste courte, la descente, la simulation, le coup le plus visité | premier jet |
| `grid` | les plans en texte, A* dans l'espace et le temps, la table de réservations | fait |
| `measure` | les intervalles de Wilson, la comparaison par paires sur les mêmes scénarios | fait |

## Les signatures de `mcts`

Un problème décrit ce que la recherche doit savoir faire ; la recherche ne connaît rien d'autre.

```js
/**
 * What a problem gives the search.
 * @typedef {object} Problem
 * @property {(state, rng) => World} sample        a scenario consistent with what is known
 * @property {(world) => string} actor             who decides now: a robot, the human, an opponent
 * @property {(world) => Move[]} moves             the legal decisions at this event
 * @property {(world, moves) => Move[]} [shortlist] the fast rule's best few (all of them by default)
 * @property {(move) => string} key                a move's name, shared by every scenario
 * @property {(world, move) => World} play         applies the move, runs to the next decision
 * @property {(world) => boolean} over
 * @property {(world, rng) => World} rollout       the fast rule to the end
 * @property {(world, actor) => number} score      the reward of a finished world, 0 to 1
 */

/** @returns {{ move: Move | null, value: number, visits: Map<string, number>, stats: object[], size: number }} */
export function search(state, problem, { budget, rng, depth = 5, explore = 0.7, common = false }) {}
```

Ce que fait une itération : elle tire un monde compatible avec ce qu'on sait (`sample`), descend l'arbre sur
les coups que ce monde permet (UCB1, compté sur les itérations où le coup était possible), ajoute le premier
coup pas encore essayé, joue la règle rapide jusqu'au bout (`rollout`), puis crédite chaque coup du score
de celui qui l'a choisi. La racine joue son coup le plus visité. `stats` donne, pour chaque coup de la racine,
ses visites et son score moyen ; `size`, le nombre de nœuds de l'arbre.

**Les mondes communs** (`common: true`) : la k-ième visite de chaque coup de la racine joue le k-ième monde
tiré, avec le k-ième flux de hasard. Les coups de la racine se comparent alors par paires, sur les mêmes
mondes : c'est indispensable quand le bruit des mondes (toute une garde, toute une journée à venir) écrase
l'écart entre deux coups. Les coups de la racine doivent être connus dans chaque monde.

Les autres modules (`schedule` est encore dans Lopin) :

```js
export function createEvents(start) {}              // { schedule(at, event), next(), peek(), clone(keep), now, size }
export function readyTasks(tasks, done, free) {}    // prerequisites finished, resources free
export function smithOrder(tasks) {}                // most weight per minute first
export function parsePlan(text) {}                  // { width, height, lines, at(x, y), inside(x, y), find(char) }
export function astar(plan, from, to, options) {}   // options: { passable(char, x, y), reservations, unit, start, horizon, park } → [{ x, y, t }] | null
export function createReservations() {}             // ({ shared }) → { reserve(unit, path, { stay }), release(unit), isFree, freeFrom, swaps, clone }
export function wilson(wins, games) {}              // { rate, low, high }
export function paired(scoresA, scoresB) {}         // { n, mean, low, high, wins, ties, losses }
```

## Comment les projets s'en servent

Sans paquet publié ni étape de build :
- **en développement**, les dépôts sont côte à côte dans le même dossier ; un projet déclare
  `"mcts-commun": "file:../mcts-commun"` dans son `package.json`, et `npm install` en fait un lien ;
- **dans la page**, une *import map* fait pointer `mcts-commun/` vers le même code, servi par le serveur
  local du projet, ou par un CDN depuis une étiquette git pour une page publiée (GitHub Pages) ;
- **une version stable** est une étiquette git (`v0.1.0`), qu'un projet peut viser à la place du dossier.

## Voir une page

`mcts-serve [port]` (`bin/serve.js`) sert le dossier courant sur 127.0.0.1 : chaque projet a un script
`npm run page`, et sa page trouve la bibliothèque par `node_modules/mcts-commun` grâce à une *import map*.
Un *worker* ne lit pas l'import map : le serveur réécrit donc, dans le JavaScript qu'il sert, les imports
`mcts-commun/…` en `/node_modules/mcts-commun/src/…` (23/10/2026, pour les gardes des urgences jouées en parallèle).

**Les replays** (Sami, 23/10) : `POST /api/replays` écrit le replay reçu dans le dossier `replays/` du projet (exclu de git, comme `replays/` dans Lopin) ; `GET /api/replays` les liste. Les pages y envoient chaque partie jouée.

## Les longs jobs de la machine (`mcts-backlog`)

Sami (23/10/2026) : l'ordonnanceur de Lopin, en commun, pour que les urgences, l'entrepôt et la cuisine lancent aussi leurs mesures de nuit. **Une seule file pour la machine**, `~/.mcts-backlog/queue.json` (`MCTS_BACKLOG_HOME` pour une autre) ; chaque job dit dans quel dossier il tourne.

```bash
npx mcts-backlog --add ent-sami --cwd ../mcts-entrepot --estimate "40 min" -- npm run compare -- --plan sami --days 200 --search
npx mcts-backlog --list      # l'ordre prévu, et les derniers jobs finis
npx mcts-backlog             # joue la file jusqu'au bout
npx mcts-backlog --add-file ../mcts-entrepot/night.json   # les mesures de nuit d'un projet
```

Chaque projet décrit ses mesures de nuit dans un `night.json` (`{ jobs: [{ id, command, estimate }] }`) : `--add-file` les ajoute, lancées dans le dossier du fichier, chaque id suivi de la date (`--tag` pour une autre), pour qu'on puisse remettre la même série la nuit suivante.

- **L'ordre** est celui de Lopin (`schedule`) : les prérequis (`--after`), une échéance (`--due`) qu'il raterait, puis la règle de Smith sur `--priority` et `--estimate`.
- **Côte à côte** : les mesures des projets n'ont qu'un fil ; les jobs tournent ensemble tant que leurs fils (`--threads`, 1 par défaut) tiennent dans ce que prête la machine (tous les cœurs moins 3, 18 au plus ; `--budget`). Le banc de Lopin du 22/10 l'avait montré : deux jobs côte à côte battent un job sur 18 fils.
- **Les créneaux** (`slots.json`) disent ce qui tourne sur la machine, quel que soit le lanceur : celui de Lopin prend les siens dans le même fichier, si bien que deux lanceurs ne demandent jamais plus de fils que la machine n'en prête. Un job qui en demande plus que tout le budget tourne seul.
- **Les gardes**, comme dans Lopin : sous 5 Go de RAM libre deux fois de suite, le job le plus récent s'arrête et finit `failed` ; à 90 °C (le serveur web de LibreHardwareMonitor), tous les jobs s'arrêtent, retournent dans la file, et elle repart sous 75 °C. Un job dure au plus `--limit` minutes (120).
- Ce qui reste : `runs/` (la sortie de chaque job), `done/AAAA-MM.json` (les jobs finis), `job-log/AAAA-MM.jsonl` (une ligne par job : fils, minutes, mémoire).

## Les règles

- Node 20, des modules ES, pas de build : le même code tourne sous Node et dans le navigateur.
- Tout est pur et testé (`npm test`) ; aucun module de `src/` n'importe `node:*` (le lanceur et `node/machine.js`, qui ne servent que sous Node, sont à part).
- Tout tirage passe par `random` : un scénario et une recherche se rejouent depuis leur graine.
- **Le contrat est testé** (`tests/api.test.js`) : ce que chaque module exporte, la forme du résultat de
  `search`, les signatures de ce README (le `Problem` et `search` doivent y être les mêmes que dans le code),
  et **l'empreinte** de la recherche : un hash de ses visites sur des problèmes jouets à graine fixe
  (`tests/fixtures/problems.js`). Une optimisation doit la garder ; un changement voulu la change, avec le
  test et ce README, dans le même commit, comme les empreintes de Lopin.

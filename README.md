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
| `events` | la simulation à événements discrets : une file d'événements datés | à faire |
| `schedule` | les ressources, les priorités, les échéances, les prérequis, la règle de Smith | dans Lopin |
| `mcts` | la recherche : le tirage d'un scénario, la liste courte, la descente, la simulation, le coup le plus visité | premier jet |
| `grid` | A*, la table de réservations | à faire |
| `measure` | les intervalles de Wilson, la comparaison par paires sur les mêmes scénarios | à faire |

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
export function search(state, problem, { budget, rng, depth = 5, explore = 0.7 }) {}
```

Ce que fait une itération : elle tire un monde compatible avec ce qu'on sait (`sample`), descend l'arbre sur
les coups que ce monde permet (UCB1, compté sur les itérations où le coup était possible), ajoute le premier
coup pas encore essayé, joue la règle rapide jusqu'au bout (`rollout`), puis crédite chaque coup du score
de celui qui l'a choisi. La racine joue son coup le plus visité. `stats` donne, pour chaque coup de la racine,
ses visites et son score moyen ; `size`, le nombre de nœuds de l'arbre.

Les autres modules, à venir :

```js
export function createEvents() {}                   // { schedule(at, event), next(), now }
export function readyTasks(tasks, done, free) {}    // prerequisites finished, resources free
export function smithOrder(tasks) {}                // most weight per minute first
export function astar(grid, from, to, options) {}   // options: { cost(cell, unit), reserved }
export function createReservations() {}             // { reserve(path, start), isFree(cell, t) }
export function wilson(wins, games) {}              // { low, high }
export function paired(scoresA, scoresB) {}         // { mean, low, high }
```

## Comment les projets s'en servent

Sans paquet publié ni étape de build :
- **en développement**, les dépôts sont côte à côte dans le même dossier ; un projet déclare
  `"mcts-commun": "file:../mcts-commun"` dans son `package.json`, et `npm install` en fait un lien ;
- **dans la page**, une *import map* fait pointer `mcts-commun/` vers le même code, servi par le serveur
  local du projet, ou par un CDN depuis une étiquette git pour une page publiée (GitHub Pages) ;
- **une version stable** est une étiquette git (`v0.1.0`), qu'un projet peut viser à la place du dossier.

## Les règles

- Node 20, des modules ES, pas de build : le même code tourne sous Node et dans le navigateur.
- Tout est pur et testé (`npm test`) ; aucun module n'importe `node:*`.
- Tout tirage passe par `random` : un scénario et une recherche se rejouent depuis leur graine.

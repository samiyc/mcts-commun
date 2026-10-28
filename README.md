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
| `mcts-codingame` (venu de `E:\Dev\Algo code in game` le 27/10/2026) | les bots CodinGame de Sami, un dossier par jeu, leur build en un seul fichier et une arène locale | `mcts`, `grid`, `random` |

Les essais demandés à chacun le 27/10 au soir, après les réglages pour un temps court : [`docs/essais-projets.md`](docs/essais-projets.md).

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
| `grid` | les plans en texte, A* dans l'espace et le temps (qui renonce tôt à une cible hors d'atteinte), la table de réservations (`src/reservations.js`, réexportée) | fait |
| `measure` | les intervalles de Wilson, la comparaison par paires sur les mêmes scénarios | fait |
| `trace` | ce qui passe par la bibliothèque : compteurs, erreurs, appels lents (voir « Les traces ») | fait |

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
 * @property {(world) => World} [copy]           a faithful copy: on common worlds, each is drawn once, then copied
 */

/** @returns {{ move: Move | null, value: number, visits: Map<string, number>, stats: object[], size: number, iterations: number, depth: number, levels: number[], ms: number, stopped: string, margin: object | null }} */
export function search(state, problem, { budget, deadline, now, rng, depth = 5, explore = 0.7, common = false, widening = 0, earlyStop = false }) {}

/** What a result says of the problem searched: [{ code, message }], codes fewIterations, flatScore, closeCall, shallow. */
export function diagnose(result, { depth = 5 }) {}
```

**Le temps plutôt que les itérations** (Sami, 27/10/2026, pour les bots CodinGame : 50 ms par tour) : avec
`deadline` (un instant de `now()`, `performance.now` par défaut), la recherche itère jusqu'à cette heure ; `budget`
devient facultatif et sert de plafond. Elle fait toujours au moins une itération, pour rendre un coup même en
retard. Sans `deadline`, rien ne change.

**Les réglages du 27/10** (Sami : « limiter les cycles, les cases parcourues »), éteints par défaut, si bien
que les coups et les visites ne changent pas :
- `widening: k`, l'élargissement progressif de Lopin (la seule variante qu'il a gardée, +2 à 4 points) : sous la
  racine, un nœud n'offre que les `⌊k + √visites⌋` premiers coups de sa liste courte ; l'arbre descend au lieu
  de s'étaler ;
- `earlyStop: true` : avec un `budget`, la recherche s'arrête dès que le coup le plus visité mène de plus
  d'itérations qu'il n'en reste. Le même coup, plus tôt.

Le résultat dit aussi ce que la recherche a vu, lu une fois l'arbre fini (rien ne coûte par itération) :
`iterations`, `depth` (le niveau le plus profond atteint), `levels` (les nœuds de chaque niveau), `ms`, `stopped`
(pourquoi elle s'est arrêtée : `budget`, `deadline`, `settled` par `earlyStop`, `empty`) et `margin` (l'écart du coup
joué sur le suivant, avec son intervalle à 95 %, par paires sur les mondes communs).
`diagnose(result, { depth })` en tire des pistes, en français, à écrire dans le journal du bot : trop peu
d'itérations par coup, un score qui ne départage rien, deux coups à égalité au bruit près, un arbre qui n'atteint
pas sa profondeur. Le mode d'emploi et ce que dit la recherche récente : [`docs/recherche.md`](docs/recherche.md).

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
export function astar(plan, from, to, options) {}   // options: { passable(char, x, y), reservations, unit, start, horizon, park, maxNodes, partial, direct } → [{ x, y, t }] | null
export function createDistances(plan, passable) {}  // { plan, to({ x, y }) → Int32Array } : les distances au sol, pour astar({ direct })
export function createReservations() {}             // ({ shared, capacity, single }) → { reserve(unit, path, { stay }), release(unit), isFree, freeFrom, swaps, stayAt(x, y), clone }
export function wilson(wins, games) {}              // { rate, low, high }
export function paired(scoresA, scoresB) {}         // { n, mean, low, high, wins, ties, losses }
```

**A* borné** (27/10/2026, pour un bot pressé) : `horizon` est la distance la plus longue permise, en pas ; une
cible plus loin rend null sans rien chercher, et A* ne fait jamais un pas d'où la cible n'est plus joignable à
temps (les mêmes chemins, plus vite). `maxNodes` plafonne les cases-instants explorées (null au-delà, compté
`capped`) ; avec `partial: true`, A* rend plutôt le chemin vers la case explorée la plus proche de la cible
(compté `partial`), pour avancer quand même. Une cible murée, avec ou sans réservations, rend null tôt.

**Plus vite, les mêmes chemins** (28/10/2026, les profils des projets) : la cible hors d'atteinte est vue dès que
A* a exploré deux fois ce qu'un chemin libre demande, et A* comme les réservations n'allouent presque plus (des clés
numériques) ; une case réservée a des coordonnées entières de −4096 à 4095. `npm run bench` le mesure, et
`docs/recherche.md` (§ 6) dit les chiffres.

**Plusieurs unités par case** (28/10/2026, cuisine) : `createReservations({ capacity: 2, single: [cases] })`. Une case
tient deux unités à la fois, une case `single` (celle d'où l'on travaille une station) n'en tient qu'une, et deux
unités se croisent de face entre deux cases d'au moins 2. Se garer veut toujours la case pour soi. Sans `capacity`,
rien ne change.

**Le trajet direct** (28/10/2026, celui de cuisine) : `astar(plan, from, to, { …, direct: createDistances(plan,
passable) })` suit les distances au sol quand chacun de ses pas est libre, A* sinon. Un plus court chemin, mais pas
toujours celui d'A* entre deux aussi courts : les empreintes d'un projet changent s'il l'adopte.

**Ce que chaque projet prend de la lib**, et vérifie avant la file : [`docs/projets.md`](docs/projets.md).

**Chaque monde commun tiré une fois** (28/10/2026, urgences) : avec un `problem.copy(world)` fidèle, la recherche en
mondes communs garde le k-ième monde tiré, et l'état de son flux, puis en donne une copie à chaque coup de la racine.
Les mêmes coups et les mêmes visites, sans les tirages répétés, contre autant de mondes en mémoire que le coup le plus
visité a eu de visites.

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

**L'allure commune** (Sami, 23/10) : `web/theme.css`, lié en premier par chaque page (`../node_modules/mcts-commun/web/theme.css`), donne le bandeau en haut, les réglages en carte, les sections pliables bien visibles (une barre, un chevron, « Ouvrir / Fermer »), les boutons, les tableaux, le thème sombre. Chaque page n'y met que sa couleur dominante (`--accent`, `--masthead`…) et ce qui est à elle : rouge et blanc pour les urgences, bleu-gris métal pour l'entrepôt, orange pour la cuisine.

**La page de `mcts-commun`** (26/10) : `npm run page` ici montre la backlog de la machine (`GET /api/backlog`, `GET /api/backlog/tail`, servis par le même serveur, donc aussi dans chaque projet). Une requête qui échoue est écrite dans `logs/serve-AAAA-MM.jsonl` du dossier servi.

**Les replays** (Sami, 23/10) : `POST /api/replays` écrit le replay reçu dans le dossier `replays/` du projet (exclu de git, comme `replays/` dans Lopin) ; `GET /api/replays` les liste. Les pages y envoient chaque partie jouée.

## Les longs jobs de la machine (`mcts-backlog`)

Sami (23/10/2026) : l'ordonnanceur de Lopin, en commun, pour que les urgences, l'entrepôt et la cuisine lancent aussi leurs mesures de nuit. **Une seule file pour la machine**, `~/.mcts-backlog/queue.json` (`MCTS_BACKLOG_HOME` pour une autre) ; chaque job dit dans quel dossier il tourne.

```bash
npx mcts-backlog --add ent-sami --cwd ../mcts-entrepot --estimate "40 min" -- npm run compare -- --plan sami --days 200 --search
npx mcts-backlog --list      # la machine, les jobs en cours, la nuit à venir, les bloqués, les derniers finis
npx mcts-backlog --tui       # la même chose en direct, façon k9s
npx mcts-backlog             # joue la file jusqu'au bout
npx mcts-backlog --add-file ../mcts-entrepot/night.json   # les mesures de nuit d'un projet
npx mcts-backlog --status ent-sami --json   # où en est un job ; --wait l'attend, --cancel l'annule, --retry le relance
```

Chaque projet décrit ses mesures de nuit dans un `night.json` (`{ jobs: [{ id, command, estimate }] }`) : `--add-file` les ajoute, lancées dans le dossier du fichier, chaque id suivi de la date (`--tag` pour une autre), pour qu'on puisse remettre la même série la nuit suivante.

- **L'ordre** est celui de Lopin (`schedule`) : les prérequis (`--after`), une échéance (`--due`) qu'il raterait, puis la règle de Smith sur `--priority` et la durée : celle qu'apprend l'archive (les derniers passages de la même commande, sinon le rythme du projet), `--estimate` faute de mieux (27/10/2026 ; voir [`docs/backlog.md`](docs/backlog.md)).
- **Côte à côte** : les mesures des projets n'ont qu'un fil ; les jobs tournent ensemble tant que leurs fils (`--threads`, 1 par défaut) tiennent dans ce que prête la machine (tous les cœurs moins 3, 18 au plus ; `--budget`). Le banc de Lopin du 22/10 l'avait montré : deux jobs côte à côte battent un job sur 18 fils.
- **Les créneaux** (`slots.json`) disent ce qui tourne sur la machine, quel que soit le lanceur : celui de Lopin prend les siens dans le même fichier, si bien que deux lanceurs ne demandent jamais plus de fils que la machine n'en prête. Un job qui en demande plus que tout le budget tourne seul.
- **Les gardes**, comme dans Lopin : sous 5 Go de RAM libre deux fois de suite, le job le plus récent s'arrête et finit `failed` ; à 90 °C (le serveur web de LibreHardwareMonitor), tous les jobs s'arrêtent, retournent dans la file, et elle repart sous 75 °C. Un job dure au plus `--limit` minutes (120).
- Ce qui reste : `runs/` (la sortie de chaque job), `traces/` (sa trace), `done/AAAA-MM.json` (les jobs finis), `job-log/AAAA-MM.jsonl` (une ligne par job : fils, minutes, mémoire), `journal/AAAA-MM.jsonl` (ce que fait le lanceur : démarrage, jobs lancés et finis, créneaux attendus, gardes, orphelins, réécritures de la file, plantage).

**Voir la backlog** (Sami, 26/10/2026 : c'était une boîte noire), toujours en lecture seule, le lanceur peut tourner :
- `npx mcts-backlog --list` : la machine en une ligne (lanceur, fils, CPU, mémoire), les jobs en cours avec leur avancement, la nuit à venir telle que le lanceur la jouerait (côte à côte dans le budget), les bloqués et pourquoi, les derniers finis ; `--json` donne la même vue ;
- `npx mcts-backlog --slot N -- commande` : un test ou une mesure hors file, dans N fils des 18 de la machine ; il passe
  avant les jobs suivants de la file, et au besoin un job commencé depuis moins de 5 min lui rend ses fils et repart
  plus tard ([`docs/backlog.md`](docs/backlog.md), recommandation 9) ;
- `npx mcts-backlog --tui` : la même chose en direct au terminal, façon k9s : six onglets (en cours, à venir, bloqués, finis, journal, traces), la ligne choisie détaillée avec la fin de sa sortie, `Entrée` pour la sortie entière, `/` pour filtrer, `?` pour l'aide ;
- `npm run page` dans `mcts-commun` (http://127.0.0.1:4800/web/) : la page, avec la frise de la nuit et la sortie de chaque job d'un clic.

**Après une nuit**, le bilan se fait en lecture seule, avant que la journée ne remplisse la file : la marche à suivre, et celui de la nuit du 26 au 27/10 (trois défauts trouvés et corrigés, des estimations apprises de l'archive), sont dans [`docs/backlog.md`](docs/backlog.md#après-une-nuit--le-bilan).

**Se brancher depuis un autre outil** (Sami, 26/10/2026) : tout passe par la commande, jamais par `queue.json` à la main, parce que la commande tient le verrou de la file (`queue.lock`). `--status`, `--wait` (son code de sortie dit comment le job a fini), `--cancel`, `--retry`, et `skipIf` sur un job, une commande du projet qui peut l'annuler juste avant son départ. Le contrat complet est dans [`docs/backlog.md`](docs/backlog.md).

**La charge, et une machine en plus** (Sami, 26/10/2026 : les 18 fils du PC suffiront-ils ?) : `--list`, le TUI et la page disent ce que la file demande à la machine, d'après les jobs déjà passés et à ses estimations, et comment se sont passées les dernières nuits. Quand elles saturent, `--push` envoie des jobs à un serveur loué ou au portable, `--pull` en rapatrie les résultats. Les coûts, ce que Sami fait lui-même et la marche à suivre sont dans [`docs/distant.md`](docs/distant.md).

## Le tableau des sessions (`mcts-board`)

Les sessions Claude des projets se parlent par un tableau, au lieu du copier-coller (Sami, 27/10/2026) :
- les messages sont des fichiers Markdown datés dans `board/`, ignoré de git, et un journal dit qui a lu quoi ;
- `npx mcts-board` poste, lit, répond et ferme un fil ;
- un hook montre à chaque session ses non-lus à chaque prompt ;
- le TUI (onglet 7) et la page (« Messages des sessions ») montrent les fils à Sami.

Un message est une information, pas un ordre. Le mode d'emploi : [`docs/board.md`](docs/board.md).

## Les traces

Sami (26/10/2026) : le tronc commun était une boîte noire quand un calcul se bloquait. `src/trace.js` (pur, chargé aussi par les pages) compte et chronomètre ce qui passe par la bibliothèque, et garde les 200 derniers événements :
- `search` et `astar` : appels, itérations, millisecondes, le plus long, les chemins introuvables (`notFound`, dont `givenUp` : ceux qu'A* a abandonnés tôt, la cible hors d'atteinte avant l'horizon, 27/10/2026), les cases explorées (`expanded` ; `expanded / calls`, ce que coûte un appel), les recherches plafonnées (`capped`) et les chemins partiels (`partial`) ; une erreur (`Problem incomplet`, un coup manquant en `common`) ou un appel lent est gardé avec ses réglages, puis l'erreur repart comme avant. **Lent**, c'est plus de 2 s **et** plus de 10 fois la moyenne des appels d'avant du même scope (27/10/2026 : à 2 s seules, les recherches ordinaires d'une cuisine faisaient 3 391 alertes en une matinée, 13 par cette règle). A* est appelé dans la recherche : son temps est compté aussi dans celui de `search` ;
- `grid` : une case réservée par-dessus une autre unité (les deux robots du 23/10), en disant si c'est dans un clone de la recherche (`clone`, compté à part dans `overbookedInClone`) ; `events` : un événement dans le passé ;
- `progress(scope, done, of, details)` : un projet dit où en est son calcul (`progress("compare", 12, 30, { unit: "service" })`), au plus une fois toutes les 5 s, la première et la dernière toujours. Le TUI, `--list`, la page et `--status --json` en tirent « service 12/30, fin vers 10:20 ».

Sous Node, `MCTS_TRACE=1` (ou `debug`, chaque appel en plus) écrit tout cela dans `logs/trace-AAAA-MM-JJ-<pid>.jsonl` du dossier courant, exclu de git : le départ du processus, les événements, **un battement toutes les 30 s** (les compteurs, la mémoire), le plantage s'il y en a un, la fin. Un calcul coincé dans une boucle ne bat plus : c'est ce que la page et le terminal signalent (« trace muette »). Les jobs de `mcts-backlog` sont tracés d'office dans `~/.mcts-backlog/traces/`. L'empreinte de la recherche ne bouge pas.

Un calcul qui ne rend jamais la main ne laisse tourner aucun minuteur : ce sont les appels à la bibliothèque qui battent (`onPulse`). Et la trace ne s'ouvre d'elle-même qu'au premier moment où le script rend la main (27/10/2026 : les jobs de la nuit n'étaient tracés qu'à leur fin). Le lanceur l'ouvre donc avant tout le reste (`--import`, `node/trace-preload.js`) ; à la main, pour un script qui calcule d'un trait, on fait de même. Une trace sans aucun appel à la bibliothèque est « lancée », jamais « muette » : son silence ne dit rien.

```bash
MCTS_TRACE=1 npm run compare -- --plan sami --days 5 --search   # logs/trace-….jsonl
NODE_OPTIONS=--import=mcts-commun/trace-preload.js MCTS_TRACE=1 npm run compare -- …   # ouverte dès le départ
```

## Les règles

- Node 24 LTS (depuis le 28/10/2026 ; le code tourne encore sous 20.9), des modules ES, pas de build : le même code tourne sous Node et dans le navigateur.
- Tout est pur et testé (`npm test`) ; aucun module de `src/` n'importe `node:*` (le lanceur et `node/`, qui ne servent que sous Node, sont à part ; `src/trace.js` ne charge `node/trace-file.js` que sous Node, par un import dynamique).
- Tout tirage passe par `random` : un scénario et une recherche se rejouent depuis leur graine.
- **Le contrat est testé** (`tests/api.test.js`) : ce que chaque module exporte, la forme du résultat de
  `search`, les signatures de ce README (le `Problem` et `search` doivent y être les mêmes que dans le code),
  et **l'empreinte** de la recherche : un hash de ses visites sur des problèmes jouets à graine fixe
  (`tests/fixtures/problems.js`). Une optimisation doit la garder ; un changement voulu la change, avec le
  test et ce README, dans le même commit, comme les empreintes de Lopin.

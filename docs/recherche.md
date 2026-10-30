# Régler la recherche et A*, et où aller ensuite

Sami, 27/10/2026 : « ajouter des paramètres pour limiter les cycles de recherche, les cases parcourues, une
distance max ; je pense au timing court de CodinGame. Qu'est-ce qui donnerait des pistes d'amélioration aux bots
sans alourdir la lib ? Que disent les chercheurs récemment ? Faut-il mettre en commun une autre variante, ou un
autre algorithme ? »

Ce document répond dans cet ordre :
1. les réglages, et quand s'en servir ;
2. ce que `diagnose` dit d'une recherche ;
3. ce que dit la recherche récente ;
4. ce qu'il vaudrait la peine de mettre en commun ;
5. les essais demandés aux projets ;
6. ce que leurs mesures du 28/10 ont appris, et ce que la lib en a fait.

## 1. Les réglages

Tous sont facultatifs. Sans eux, les coups, les visites et les chemins ne changent pas : les empreintes
(`tests/api.test.js`, `tests/fingerprint.test.js`) le gardent.

### La recherche, `search(state, problem, options)`

| Réglage | Ce qu'il borne | Depuis |
|---|---|---|
| `budget` | le nombre d'itérations (les « cycles ») | le début |
| `deadline`, `now` | l'heure de fin, en ms de `now()` ; `budget` devient un plafond ; au moins une itération | 27/10 matin |
| `depth` | les niveaux de l'arbre (5) ; la simulation va ensuite jusqu'au bout | le début |
| `widening: k` | sous la racine, un nœud n'offre que les `⌊k + √visites⌋` premiers coups de sa liste courte | 27/10 soir |
| `earlyStop: true` | avec un `budget`, s'arrêter dès que le coup en tête ne peut plus être rattrapé | 27/10 soir |
| `problem.copy(world)` | sur les mondes communs, chaque monde tiré une fois, puis copié pour chaque coup de la racine | 28/10 |

**L'élargissement progressif** (`widening`) est la seule variante que Lopin a gardée après les avoir toutes
mesurées : +2 à 4 points sur 420 parties. Ses niveaux `pwl` correspondent à ces `k` :

| `pwl` de Lopin | 1 | 2 | 3 (retenu) | 4 | 5 |
|---|---|---|---|---|---|
| `widening` | 3 | 2 | 1,5 | 1 | 0,75 |

Plus `k` est petit, plus l'arbre descend au lieu de s'étaler. La racine n'est jamais élargie : chaque coup y est
essayé.

**L'arrêt anticipé** (`earlyStop`) rend le même coup qu'une recherche menée jusqu'au bout : on s'arrête seulement
quand l'avance du coup le plus visité dépasse les itérations qui restent. Le hasard consommé change, d'où l'option
désactivée par défaut. Il sert aux longs jobs de la file, où chaque recherche épargnée compte. Sans `budget`, il
n'y a rien à compter, et l'option est ignorée.

### A*, `astar(plan, from, to, options)`

| Réglage | Ce qu'il borne |
|---|---|
| `horizon` | le nombre de pas au plus : c'est la « distance max » |
| `maxNodes` | les cases-instants explorées au plus ; au-delà, null (compté `astar.capped`) |
| `partial: true` | au lieu de null, le chemin vers la case explorée la plus proche de la cible (compté `astar.partial`) |
| `direct: createDistances(plan, passable)` | le trajet au sol d'abord, quand chacun de ses pas est libre ; A* sinon (compté `astar.direct`) ; les mêmes trajets que celui de cuisine (28/10) |
| `createReservations({ capacity, single })` | `capacity` unités par case à la fois (1 par défaut), une seule sur les cases `single` ; deux unités se croisent de face entre deux cases d'au moins 2 (28/10) |

Depuis le 27/10 au soir :
- une cible plus loin que l'horizon rend null sans rien explorer ;
- A* ne fait jamais un pas d'où la cible n'est plus joignable avant l'horizon. Les chemins restent les mêmes,
  ils sont trouvés plus vite ;
- une cible murée rend null tôt, avec ou sans réservations ;
- le test « hors d'atteinte » ne grossit plus sur un plan large (`docs/backlog.md`, « A* ou la recherche ? ») ;
- avec `partial`, l'horizon ne coupe plus que par le temps : le chemin partiel s'arrête au plus tard à l'horizon.

Depuis le 28/10 (§ 6), les mêmes chemins, plus vite :
- la cible hors d'atteinte est vérifiée dès que la recherche a exploré `2 × (distance + 1) + 8` nœuds, et non plus
  autant que le plan a de cases : une unité enfermée dans un cul-de-sac abandonne tout de suite. Avec `partial`,
  rien ne change ;
- A* et les réservations n'allouent presque plus : des clés numériques, un nœud créé seulement pour un pas permis.
  Une case réservée a ses coordonnées entières, de −4096 à 4095 ; au-delà, `reserve` refuse.

`astar.givenUp` monte d'autant : ce sont les échecs vus tôt, pas des échecs de plus.

Le compteur `astar.expanded` additionne les cases explorées. `expanded / calls` dit ce que coûte un appel ; on le lit
dans les compteurs de la trace d'un job (`counters.astar` du dernier battement).

`maxNodes` plutôt qu'une heure pour A* : un plafond en cases est **déterministe**, si bien qu'un replay rejoue les
mêmes chemins. Pour la recherche, c'est l'inverse : CodinGame donne un temps, d'où `deadline`.

### Pour un bot CodinGame

```js
const turnStart = performance.now();
// 50 ms par tour (1 s au premier) : garder une marge pour lire l'entrée et écrire la sortie.
const found = search(state, problem, { deadline: turnStart + 40, rng, widening: 1.5 });
for (const hint of diagnose(found, { depth: 5 })) console.error(hint.message);
const path = astar(plan, me, target, { passable, horizon: 30, maxNodes: 3000, partial: true });
```

- La sortie d'erreur est le journal du bot : CodinGame l'affiche sous la partie, sans la compter comme un coup.
- **Un seul fichier** : CodinGame ne prend qu'un fichier, alors que la lib n'a pas d'étape de build. Il faudra
  concaténer les modules au moment de soumettre (un petit script, ou esbuild). À faire au premier défi, pas avant.
- **Les traces** coûtent une addition par appel quand `MCTS_TRACE` n'est pas posé ; le fichier n'est jamais chargé.

### Faisceau et escalade, pour les jeux à 50 ms (29/10/2026)

MCTS (`search`) cherche sous incertitude : il tire des mondes, il fait jouer les acteurs chacun leur tour. Dans un jeu
presque déterministe à 50 ms le tour, deux recherches de la lib font mieux (le README, « Le faisceau et l'escalade ») :
- **le faisceau** (`createBeam`), quand nos actions sont peu nombreuses et discrètes et que les adversaires se
  modélisent simplement. Hypersonic v2 : 10 actions, 14 tours, 120 états ; « la profondeur paie, pas la largeur »
  (75/3/2 à 14 tours, 65/7/8 à 10 ; 300 états au lieu de 120 n'apportent rien). La largeur paie pourtant quand elle
  s'étale : Hypersonic v4 garde 500 états, mais au plus 12 sur la case de son joueur (`group`, `perGroup`), et gagne
  61 % des duels à 4 contre la v3 [54-68] (de la 241e place à environ la 20e en Légende). Le plafond par case est plat
  de 6 à 30 ; contraindre la racine (un quota par premier coup, le Sequential Halving) fait perdre, 36 % contre la v4
  (codingame, 29/10 au soir, `docs/beam-search-infos.md` de mcts-codingame) : le faisceau local simple reste le réglage ;
- **l'escalade** (`createClimb`), quand le coup est un plan de nombres (un angle et une poussée par tour) et que le plan
  du tour d'avant, décalé, est déjà bon. Mad Pod Racing v4 : 24 gènes, l'adversaire prédit par une seconde escalade.

Ce qu'il faut pour le ramasse-miettes, appris par codingame le 28/10 et mesuré au banc le 29/10
(`bench/beam-climb.js`) :
- **un état typé et compact** (un `Uint8Array` copié par `set`), avec un test d'équivalence champ par champ contre
  le moteur lisible ;
- **rien d'alloué par nœud ni par plan** : ni objet, ni tableau, ni `Map`, ni tri complet. Un faisceau d'objets
  coûte 1,6 fois le temps et 281 passages du ramasse-miettes en 1 000 tours, contre 0 pour celui de la lib ;
- **le hasard et l'horloge** : `createRng` n'alloue plus rien depuis le 29/10, et il va 5 fois plus vite ;
  `performance.now()` alloue toujours, et `clockEvery` le lit moins souvent. Cela ne paie que pour une note presque
  gratuite : Mad Pod Racing, qui simule ses plans, n'y gagne rien ;
- **une feuille atténuée comme les gains** (`fade`), sinon la recherche remet à plus tard ce qui rapporte ;
- **une prudence par niveaux** quand rien ne survit au pire, plutôt que de rester sur place : le bot rappelle `run`
  avec un modèle moins méfiant.

### Pour les jobs de la backlog

- `earlyStop: true` sur les recherches à `budget` des cuisines et de l'entrepôt : le même coup, moins d'itérations.
  À mesurer sur un lot : `search.iterations` dans les traces dit ce qui a été épargné.
- `astar.expanded / astar.calls` dans les traces : un projet dont les appels explorent beaucoup a un horizon trop
  long, ou des cibles souvent prises.

## 2. Ce que `diagnose` dit d'une recherche

`search` rend maintenant aussi ce qu'il a vu :
- `iterations` : les itérations faites ;
- `depth` : le niveau le plus profond atteint ;
- `levels` : les nœuds par niveau, `levels[0]` étant les coups de la racine ;
- `ms` : le temps réel. Pour juger une épargne, les itérations valent mieux : le code joué en second est déjà chaud
  (urgences, 27/10) ;
- `stopped` : pourquoi la recherche s'est arrêtée (`budget`, `deadline`, `settled` quand `earlyStop` a vu le coup
  acquis, `empty` sans coup à juger) ;
- `margin` : l'écart du coup joué sur le suivant le plus visité, `{ mean, low, high, n, paired }`, avec son
  intervalle à 95 %. Sur les mondes communs, il se mesure par paires (`paired` de `src/measure.js`), la chance des
  mondes retirée ; sinon, avec la variance mesurée de chaque coup.

Tout est lu une fois l'arbre fini : rien ne coûte pendant les itérations. `diagnose(result, { depth })` en tire des
pistes, `[{ code, message }]`, en français. Il ne dit rien quand la racine avait moins de deux coups.

| Code | Quand | La piste |
|---|---|---|
| `fewIterations` | moins de 20 itérations par coup de la racine, sauf quand `earlyStop` a arrêté la recherche (`stopped: "settled"`) : c'est alors l'épargne | un rollout plus rapide, une liste courte plus courte, plus de temps |
| `flatScore` | tous les coups de la racine ont le même score (tous à 0, par exemple) | une récompense graduée (un retard, une marge) plutôt qu'un 0 ou 1 |
| `closeCall` | l'intervalle de `margin` contient 0 : le coup joué ne se distingue pas du suivant | le choix est un tirage : des mondes communs (`common`) s'ils manquent, plus d'itérations |
| `shallow` | l'arbre n'atteint pas la profondeur demandée | si le problème va plus loin, `widening` ou une liste courte plus courte |

**Corrigé le soir du 27/10, après les essais des trois projets** :
- `closeCall` se jugeait avec la borne `p(1 − p)`, sans tenir compte des mondes communs. Il sortait dans 56 à 100 %
  des décisions de la cuisine, de l'entrepôt et des urgences : il ne disait plus rien ;
- `fewIterations` sortait sur les recherches qu'`earlyStop` avait arrêtées exprès : 79 % au Plan blanc, 40 % au bord
  étroit.

Les comptes de ce soir-là sont donc à refaire avec la nouvelle version.

Un `flatScore` peut aussi vouloir dire qu'**il n'y a rien à chercher** : avant de revoir le score, vérifier si toutes
les règles donnent la même mesure sur ces décisions (urgences, 27/10 : sur les lits d'aval, le retard et l'attente
restent les mêmes quel que soit le patient choisi ; seul l'ordre change).

`flatScore` vient des post-mortems de CodinGame. Un joueur du Summer Challenge 2024 avait des scores qui restaient
à 0 la plupart de la partie : sa beam search choisissait au hasard, jusqu'à ce qu'une heuristique remplace le
score. Lopin avait vu la même chose à l'envers : la marge de bornes ne rapportait rien de plus, puisque seule la
victoire compte.

## 3. Ce que dit la recherche récente (recherches web du 27/10/2026)

### MCTS

- **Pas de grand saut sans réseau de neurones.** L'essentiel des travaux de 2025-2026 vise AlphaZero et MuZero :
  les priors appris, PUCT, les lots pour le GPU. Lopin a mesuré PUCT avec l'avis de sa règle rapide : 49,8 puis
  47,2 %, perdu.
- **Comparison of MCTS Variants** (Guba et Gemrot, 2025) compare les variantes classiques et propose une
  *Weighted Propagation MCTS*. À lire avant d'essayer une autre remontée des scores : Lopin a perdu avec la sienne
  (minimax implicite, `margin`, `forkCut`).
- **DyRo-MCTS** (2025) : une MCTS « robuste » pour l'atelier dynamique, où les tâches arrivent en cours de route.
  Elle préfère les décisions qui restent bonnes quand la suite change. C'est le cas des urgences et de la cuisine :
  une piste pour leur score, pas pour la lib.
- **Epistemic MCTS** (ICLR 2025) : séparer l'incertitude du modèle de celle du jeu, pour explorer plus loin.
  Utile avec un modèle appris, pas pour nous aujourd'hui.
- **Sur l'ISMCTS**, rien de neuf en 2025. Les références restent :
  - Cowling, Powley et Whitehouse 2012, notre base ;
  - la re-déterminisation (Hanabi, 2018) : le joueur qui agit ne doit pas « voir » ce que les autres ignorent ;
  - les ensembles de déterminisations (Magic, 2012).

### A* et les chemins à plusieurs

- **Notre A\* coopératif à horizon, c'est le WHCA\* de Silver (2005)** : chaque unité planifie à son tour, autour
  des chemins déjà réservés.
- **L'état de l'art des chemins à plusieurs (MAPF) est PIBT et LaCAM** (Okumura). Ils planifient un pas pour toutes
  les unités à la fois, la priorité passant à celle qui est bloquée, et tiennent des centaines ou des milliers
  d'unités en millisecondes. Les travaux récents :
  - le *guidage local* (AAAI 2026) : un court chemin espace-temps par unité, dans une fenêtre, oriente PIBT ;
  - *Real-Time LaCAM* (SoCS 2025) : la même chose sous une limite de temps par pas, le cas de CodinGame ;
  - *Lifelong LaCAM* (2026) : des tâches qui arrivent sans fin, replanifiées par fenêtre avec un A* espace-temps,
    le cas de l'entrepôt.
- **Pour un seul A\* plus rapide, au prix d'un chemin un peu plus long** :
  - le *Weighted A\** (`f = g + w·h`), et sa variante à sous-optimalité dynamique (DSWA\*, Hami et Sturtevant,
    2025), qui répartit la marge pendant la recherche ;
  - la *focal search*.

  Notre file d'évènements refuse un instant passé, et un A\* pondéré fait reculer `f` : il lui faudrait son propre
  tas. Noté, pas fait.

### Les bots CodinGame (les post-mortems 2020-2026 du forum)

- **La beam search domine** pour les jeux presque déterministes. Les réglages cités :
  - une largeur de 50 à 3 000, et une profondeur de 10 à 30 ;
  - 5 ms pour l'adversaire, 40 pour soi, sur 50 ms par tour.
- **La MCTS** gagne quand l'adversaire compte et que la simulation est rapide. Plusieurs joueurs l'ont quittée
  faute de simulations : 12 000 à 20 000 rollouts en 48 ms ne suffisaient pas.
- **Les leçons qui reviennent** :
  - une boucle « tant qu'il reste du temps » (notre `deadline`) ;
  - une marge sous la limite, car un pas trop long fait perdre la partie ;
  - l'évaluation avant la profondeur ;
  - vérifier que l'arbitre local mesure le temps comme le serveur.
- **Pour les coups simultanés**, Smitsimax : un arbre par joueur, chacun choisissant sans voir l'autre.
- **Pour les jeux à populations**, des algorithmes génétiques, avec une population par joueur.
- **Chercher jusqu'à l'échéance**, pas à une profondeur fixe : pour `beam.run`, `depth` grand et `deadline` qui décide ;
  la couche coupée est jetée. Hypersonic, 30/10 : remettre la profondeur 14 au lieu de 50 fait perdre (36 %). Le site
  compte plus large que nous : 2 timeouts en 20 parties avec une échéance à 98 ms sur 100, d'où 95.

## 4. Ce qu'il vaudrait la peine de mettre en commun

La règle de la lib : **un projet le prouve d'abord, la lib le reprend ensuite**, mesuré sur les mêmes scénarios
qu'une règle simple, avec son intervalle.

| Quoi | Pour qui | Quand | Pourquoi |
|---|---|---|---|
| **beam search** | CodinGame | **dans la lib depuis le 29/10** (`beam`, celui d'Hypersonic v2) | l'outil le plus cité des post-mortems pour un jeu presque déterministe ; inutile pour nos projets, où le hasard (les durées, les arrivées) appelle des scénarios |
| **l'escalade d'un plan continu** | CodinGame | **dans la lib depuis le 29/10** (`climb`, celle de Mad Pod Racing v4) | 1152e à 64e sur 1841 en une soirée ; le génétique ne la bat pas (codingame, 30/10 : Mad Pod Racing, même plan, de 46 % à 51 % contre elle, 51 % même à 4 fois le temps) : il lui faut beaucoup de générations, quand l'escalade décalée hérite du tour d'avant ; il reste hors de la lib |
| **des graines pour `climb`** (quelques plans simples essayés au départ : viser le checkpoint suivant, le meneur…) | CodinGame | quand un client a du temps par tour | rien à 45 ms (51 %), 59 % à 90 ms et 68 % à 180 ms contre la v5 de Mad Pod Racing (codingame, 30/10) |
| **PIBT** (un pas pour toutes les unités, priorité à la bloquée) | l'entrepôt d'abord, puis la cuisine et les jeux à plusieurs unités | quand l'entrepôt grandit : plus de robots, des plans plus larges | des centaines d'unités en millisecondes ; à mesurer contre l'A* coopératif sur les mêmes journées |
| **Smitsimax / UCT découplé** | CodinGame, coups simultanés | au premier défi de ce genre | notre ISMCTS fait jouer un acteur après l'autre |
| **la réutilisation de l'arbre** d'un tour à l'autre (`reuse` de Lopin) | CodinGame, Lopin | au premier défi | les itérations du tour d'avant sont gratuites ; à mesurer, Lopin ne l'a pas départagée |
| **le trajet direct** sur les distances au sol, A* seulement si une case du trajet est prise | cuisine l'a prouvé (28/10) | **dans la lib depuis le 28/10** (`direct`, Sami : s'il va environ 4 fois plus vite) | 2 à 4 fois plus vite chez cuisine contre l'ancien A* ; contre le nouveau, 15 à 25 % au banc ; il change les chemins, donc les empreintes |
| **le halving à la racine** | — | pas maintenant | neutre dans Lopin (49,5 %) |
| **PUCT, le minimax implicite** | — | non | perdus dans Lopin (47 à 50 %) ; sans réseau, l'avis de la règle rapide pousse vers son favori, que l'arbre est là pour corriger |

**Pour les projets d'aujourd'hui** (urgences, cuisine, entrepôt), la recherche actuelle reste la bonne : des
décisions en ligne sous incertitude, jugées sur des scénarios communs. Ce qui reste à gagner est dans leurs
problèmes, pas dans la lib : la liste courte, le score (DyRo-MCTS), la vitesse du rollout. `diagnose` dira
lequel des trois.

## 5. Les essais demandés aux projets (27/10/2026 au soir)

Sami a demandé à chaque session de vérifier le correctif et d'essayer les réglages, avec des jobs dans la file de
jour. Les prompts sont dans [`essais-projets.md`](essais-projets.md).

| Projet | Ce qu'il vérifie | Ce qu'il mesure |
|---|---|---|
| cuisine | ses empreintes ; les mêmes plats à l'heure | A* sur couloir et tables-detour contre les chiffres du matin ; `diagnose` ; `earlyStop` par paires |
| entrepot | ses empreintes ; les mêmes journées, à l'identique | `ligne-retours` (38 min pour 23 annoncées, 50 heures de ligne) avant et après le correctif ; `diagnose` ; `earlyStop` par paires |
| urgences | ses empreintes | `diagnose` sur ses recherches de garde et de parcours ; `earlyStop` par paires |
| CodinGame | un premier bot d'un seul fichier qui tient son temps | une règle simple, puis la recherche à `deadline` ; ce qui manque à la lib |

Ce que les réponses décideront :
- `earlyStop` devient-il le réglage des projets ? Leurs empreintes changeraient alors, c'est à Sami de trancher.
- La beam search, Smitsimax ou la réutilisation de l'arbre entrent-elles dans la lib ? Seulement si le bot
  CodinGame les a prouvées.
- Quel levier chaque projet travaille-t-il ensuite ? Celui que `diagnose` désigne le plus souvent.

## 6. Les mesures du 28/10 : où passe le temps

Sami a fait mesurer la vitesse à chaque projet le 28/10. Leurs profils, croisés :

| Projet | Ce que dit son profil |
|---|---|
| entrepôt | A* prend 52 à 71 % d'une journée, dont 36 à 48 % en propre dans `expand` et `explore`, et 7 à 10 % de ramasse-miettes. Les échecs font 29 à 34 % du temps d'A* (0,45 à 0,92 ms l'un, contre 0,09 à 0,51 ms un succès). `isFree`, `swaps` et `holdMoves` en font 6 à 9 % |
| cuisine | le coût est dans le nombre d'appels : 244 000 appels de 9 à 15 cases, à 0,07-0,14 ms chacun, soit le coût fixe d'un appel. Au couloir, 60 000 appels sur 82 000 ne trouvent rien : un cuisinier bloqué qui redemande à chaque tour |
| urgences | sur les mondes communs, le k-ième monde était tiré une fois par coup de la racine ; `events.clone` triait tout le tas (2 %) |

**Ce que la lib a corrigé** (les mêmes chemins, les mêmes coups et les mêmes empreintes, vérifiés contre l'ancien
code sur 4 000 cas tirés au hasard), mesuré par `npm run bench` (`bench/grid-search.js`), l'ancien et le nouveau
code en alternance :

| Cas du banc | Avant | Après |
|---|---|---|
| un plan d'entrepôt de 40 × 21, dix robots garés, des succès et des échecs | 1,08 ms l'appel, 129 nœuds | 0,15 ms, 116 nœuds |
| un cuisinier enfermé dans un cul-de-sac, horizon 55 | 0,49 ms, 75 nœuds | 0,02 ms, 34 nœuds |
| des appels courts (3 nœuds) | 24 µs | 3 µs |
| `clone` d'une table de dix chemins | 66 µs | 61 µs |
| une recherche à 64 itérations sur 4 coups, en mondes communs, un tirage coûteux | 1,9 ms | 0,6 ms avec `copy`, 1,9 ms sans |

Le **trajet direct** (`direct`), repris de cuisine le même jour : au banc, 0,15 → 0,12 ms l'appel sur le plan d'entrepôt
(83 nœuds au lieu de 116), soit 15 à 25 % ; il valait 2 à 4 fois contre l'ancien A*. **Node 24** contre Node 20.10 :
A* et `clone` 15 à 25 % plus vite au banc, et 3 journées du petit plan de l'entrepôt avec la recherche en 1,54 s au
lieu de 1,99 s (−22 %).

Un banc n'est pas une journée : le gain réel se lit dans les traces des jobs, par `astar.ms / astar.calls` et
`search.ms / search.calls` (`docs/backlog.md`, « Le 28/10 »).

**Ce que les projets ont fait de leur côté**, sans toucher à la lib :
- **cuisine**, 2 à 4 fois plus vite : les distances au sol gardées, un trajet direct qui les suit quand il est libre,
  et un cuisinier ou une cible muré conclu sans A* ;
- **entrepôt** : un filtre avant A* (un remplissage autour des robots garés, sur des `Int32Array`), −7 à −16 % du temps
  d'A*, puis `shutsIn` en un seul étiquetage du sol, jusqu'à −7 %. Avec l'échec vu tôt dans A*, le filtre devient en
  partie redondant : l'entrepôt le remesurera ;
- **urgences**, −38 à −44 % : les mondes ne tiennent plus la comptabilité des mesures, les chemins à pied sont
  calculés une fois par couple de cases, et chaque monde tiré une fois (ce que `copy` offre maintenant à tous).

**Les conseils qui en sortent, pour tous les projets** :
- **pas d'A\* quand le trajet direct est libre** : ses distances au sol se gardent par plan ;
- **ne pas redemander un chemin à chaque tour pour une unité bloquée** : attendre qu'une case autour d'elle change ;
- **un filtre bon marché avant un calcul cher**, sur des tableaux typés réutilisés plutôt que des `Set` à clés
  texte : la première version de l'entrepôt, en `Set`, coûtait autant qu'elle épargnait ;
- **garder aux objets une forme fixe** : urgences a vu `Object.assign` sur place plus lent que l'étalement
  `{ ...a, ...b }`, l'objet perdant la forme que V8 optimise ;
- **une règle simplifiée dans les mondes peut changer le vainqueur** (lopin : la recherche joue ses donnes à la
  règle final pour la vitesse, la partie se joue à claim-end, et les deux ne s'accordent que dans 91 % des parties).
  Un projet qui simule plus simple que la vraie règle le vérifie sur les décisions perdues « à coup sûr » ;
- **`copy` se gagne sur les mondes chers à tirer** : il garde autant de mondes que le coup de la racine le plus
  visité a eu de visites, en mémoire. Sa copie doit être fidèle : les empreintes du projet le vérifient.

Ce que chaque projet doit en prendre, et vérifier avant la file : [`projets.md`](projets.md).

### Le 30/10 : où passe le temps aujourd'hui

Sami, 30/10 au soir : « réanalyser la lib pour voir s'il n'y a pas d'autres optimisations possibles ». Relevé dans le
dernier battement des traces de trois jobs du jour (`~/.mcts-backlog/traces`) :

| Projet | A* | `search` | Part de la lib chronométrée |
|---|---|---|---|
| entrepôt (`regle-assemblage-021`) | 2 689 461 appels, 151 s : **56 µs l'appel**, 23,6 nœuds, 7,7 % sans chemin | 334 recherches, 514 s, 39 782 itérations : **13 ms l'itération** | **29 %** |
| cuisine (`cuis-tables-detour-…`) | 11 644 308 appels, 112 s : **9,6 µs l'appel**, 91,5 % en trajet direct | 2 535 recherches, 1 098 s, 307 520 itérations : **3,6 ms l'itération**, 38 appels A* chacune | **10 %** |
| urgences (`gains-chu-accident`) | aucun | 27 198 recherches, 910 s, 2,72 M d'itérations : **0,33 ms l'itération** | ~0 % |

Le reste, 70 à 90 % d'une itération, est dans les rappels du problème (`sample`, `copy`, `play`, `rollout`) et dans ce que
la lib ne chronométrait pas (`reserve`, `clone`, la file d'événements). D'où les scopes ajoutés le même soir : la trace
d'un job dit maintenant `rollout.ms / search.ms` et `copy.ms / search.ms` (0,16 µs le chronométrage, moins de 0,5 %
d'une itération d'urgences), et `bench/profile.js` donne les fonctions au plus de temps propre.

**Le banc de la lib** (`npm run bench`, Node 24, trois passages : le bruit est de ±5 %, donc un gain se mesure en
alternance, ancien et nouveau, cinq passages chacun) : l'entrepôt 127-141 µs l'appel (116 nœuds), le trajet direct
111-118, le cul-de-sac 20-22, les appels courts 3, `clone` 55, la recherche commune 1,9-2,0 ms, avec `copy`
0,57-0,63 ms. `bench/beam-climb.js` : le faisceau 4,4 ms le tour, le faisceau local 16,2, l'escalade 0,09 ms pour
1 500 plans, 0 passage du ramasse-miettes.

**Le profil du banc A*** : `expand` 17 %, `explore` 14 %, le `push` du tas 7 %, `spread` 5 %, le ramasse-miettes 4 %,
`swaps` 3 %, `copyOf` 6 % (le reste est le banc lui-même). Ce qui coûte dans A* : un objet par voisin (`nodeOf`), le
`Set` des nœuds vus, les échanges du tas. **Le faisceau** : `tryAction` 54 %, c'est-à-dire les rappels du problème
inlinés ; la lib n'y pèse rien.

**Ce qui ne vaut pas le coup** :
- la boucle de `search` (`candidates`, `widened`, `step`, `backpropagate` allouent des Map et des tableaux) : 3 à 5 µs
  l'itération contre 330 à 13 000 µs d'itération chez les projets, moins de 1,5 % ;
- `createRng`, déjà sur `Uint32Array` ; le faisceau, l'escalade et les réserves, 0 allocation ;
- la file d'événements : un tas, un clone en O(n) ; `next()` rend un objet par événement, mais le contrat
  (`{ at, event }`) et les tests y tiennent ;
- du parallélisme dans la lib : la file remplit déjà les 18 fils, rien à gagner en débit.

**A* sur tableaux typés : essayé le 31/10, sans gain, abandonné.** L'arène des nœuds en `Int32Array`, un tas d'indices,
les nœuds vus horodatés au lieu d'un `Set` : les mêmes chemins (le corpus de 4 000 appels de `tests/fingerprint.test.js`,
ajouté pour l'occasion et gardé), mais au banc, cinq passages en alternance, l'entrepôt 131 → 137 µs l'appel, les
appels courts 3 → 4 µs. Le profil le dit : le ramasse-miettes passe de 4 à 2 % et le tas disparaît du haut, mais
`explore` et `expand` ne baissent pas, et `isFree`, `swaps`, `canStep` sortent de l'inlining. V8 alloue ces petits
objets pour presque rien ; ce qui coûte dans A*, ce sont les appels (`passable`, `isFree`, `swaps`), pas les objets.
On attendait −30 à −50 % ; la mesure a tranché avant le commit. Les pistes qui restent sur A* sont ailleurs :
- **une cible occupée par une unité garée pour de bon**, demandée sans `park` par une unité qui n'arrivera pas avant
  qu'elle se gare : A* explore tout l'espace jusqu'à l'horizon (dans le corpus, 5 s pour un appel à l'horizon par défaut
  de 4 × largeur × hauteur). La borne `t + distance ≥ stay.from` coupe ces appels à la racine, avec le même résultat
  (null), mais ses compteurs et les chemins partiels changent : une empreinte à recalculer, à décider. Depuis le 31/10,
  `astar.parkedTarget` compte ces appels dans la trace : si le compte pèse face à `notFound` chez entrepôt ou cuisine,
  la borne vaut le coup ;
- **un `passable` précalculé** (un `Uint8Array` par plan et par règle, fourni par le projet), pour épargner l'appel par
  voisin : à mesurer chez cuisine, dont 11,6 M d'appels sont des trajets directs.

**Le ramasse-miettes des jobs, mesuré le 31/10** : un run court et déterministe par projet, 4 fils, trois passages en
alternance, `--trace-gc` pour compter les collections de la jeune génération.

| Projet (le run) | Par défaut | Semi-espace forcé à 32 Mo | Forcé à 64 Mo |
|---|---|---|---|
| cuisine (20 services, petite cuisine) | 6 985 ms, 435 collections | −2,1 % | **−4,9 %**, 115 collections |
| entrepôt (8 jours, plan de Sami) | 31 428 ms, 1 029 collections | −1,7 % | −1,2 % (dans le bruit), 613 collections |
| urgences (8 journées du parcours, budget 100) | 4 187 ms, 524 collections | −7,5 % | **−10,1 %**, 242 collections |

Deux leçons. `--max-semi-space-size` seul ne change rien : la jeune génération ne grandit qu'à forte survie, et ces
runs n'y arrivent pas (le même nombre de collections à 32, 64 ou 128 Mo). Il faut la fixer,
`--min-semi-space-size=64 --max-semi-space-size=64`, et `--min-semi-space-size` est **refusé dans `NODE_OPTIONS`** : le
lanceur ne peut donc pas le donner aux jobs. Sa place est sur la ligne `node` des commandes des jobs
(`node --min-semi-space-size=64 --max-semi-space-size=64 scripts/…`, les workers du processus en héritent), chez
urgences et cuisine d'abord, chacun après l'avoir vu sur son job de référence. Le coût : 128 Mo de jeune génération
par processus et par worker (8 fils : 1 Go). Entrepôt n'y gagne rien, ses journées allouent moins.

## Sources

- [Guba et Gemrot, *Comparison of Monte Carlo Tree Search Variants* (2025)](https://ceur-ws.org/Vol-4092/paper2.pdf)
- [*Epistemic Monte Carlo Tree Search*, ICLR 2025](https://proceedings.iclr.cc/paper_files/paper/2025/file/bcbd670951a6dede2123961de19e5ea3-Paper-Conference.pdf)
- [*DyRo-MCTS: A Robust MCTS Approach to Dynamic Job Shop Scheduling* (2025)](https://arxiv.org/pdf/2509.21902)
- [*Re-determinizing ISMCTS in Hanabi*](https://ar5iv.arxiv.org/html/1902.06075)
- [*Local Guidance for Configuration-Based MAPF*, AAAI 2026](https://arxiv.org/pdf/2510.19072)
- [*Real-Time LaCAM for Real-Time MAPF*, SoCS 2025](https://ojs.aaai.org/index.php/SOCS/article/download/35993/38148/40065)
- [*Lifelong LaCAM with Local Guidance* (2026)](https://arxiv.org/html/2605.16855v1)
- [Okumura, *LaCAM*, AAAI 2023](https://ojs.aaai.org/index.php/AAAI/article/view/26377/26149)
- [mapf.info, les publications](http://mapf.info/index.php/Main/Publications)
- [Hami et Sturtevant, *Suboptimal Search with Dynamic Distribution of Suboptimality* (2025)](https://webdocs.cs.ualberta.ca/~nathanst/papers/hami25dynamicsuboptimality.pdf)
- [Forum CodinGame, *Managing timeout*](https://forum.codingame.com/t/managing-timeout/205037)
- [Summer Challenge 2024, stratégies](https://forum.codingame.com/t/summer-challenge-2024-feedback-and-strategies/204471)
- [Winter Challenge 2024, stratégies](https://forum.codingame.com/t/winter-challenge-2024-feedback-and-strategies/205711/66)
- [Winter Challenge 2026, stratégies](https://forum.codingame.com/t/winter-challenge-2026-feedbacks-and-strategies/208044/7)
- Lopin : `docs/priorites-1.3.md` et `docs/1.3-to-oracle-shift.md` (les variantes mesurées), `src/sim/mcts/` (leur code)

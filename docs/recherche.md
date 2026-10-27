# Régler la recherche et A*, et où aller ensuite

Sami, 27/10/2026 : « ajouter des paramètres pour limiter les cycles de recherche, les cases parcourues, une
distance max ; je pense au timing court de CodinGame. Qu'est-ce qui donnerait des pistes d'amélioration aux bots
sans alourdir la lib ? Que disent les chercheurs récemment ? Faut-il mettre en commun une autre variante, ou un
autre algorithme ? »

Ce document répond dans cet ordre :
1. les réglages, et quand s'en servir ;
2. ce que `diagnose` dit d'une recherche ;
3. ce que dit la recherche récente ;
4. ce qu'il vaudrait la peine de mettre en commun.

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

Depuis le 27/10 au soir :
- une cible plus loin que l'horizon rend null sans rien explorer ;
- A* ne fait jamais un pas d'où la cible n'est plus joignable avant l'horizon. Les chemins restent les mêmes,
  ils sont trouvés plus vite ;
- une cible murée rend null tôt, avec ou sans réservations ;
- le test « hors d'atteinte » ne grossit plus sur un plan large (`docs/backlog.md`, « A* ou la recherche ? ») ;
- avec `partial`, l'horizon ne coupe plus que par le temps : le chemin partiel s'arrête au plus tard à l'horizon.

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
- `ms` : le temps réel.

Tout est lu une fois l'arbre fini : rien ne coûte pendant les itérations. `diagnose(result, { depth })` en tire des
pistes, `[{ code, message }]`, en français. Il ne dit rien quand la racine avait moins de deux coups.

| Code | Quand | La piste |
|---|---|---|
| `fewIterations` | moins de 20 itérations par coup de la racine | un rollout plus rapide, une liste courte plus courte, plus de temps |
| `flatScore` | tous les coups de la racine ont le même score (tous à 0, par exemple) | une récompense graduée (un retard, une marge) plutôt qu'un 0 ou 1 |
| `closeCall` | les deux premiers coups sont à égalité, à deux erreurs types près | le choix est un tirage : des mondes communs (`common`), plus d'itérations |
| `shallow` | l'arbre n'atteint pas la profondeur demandée | si le problème va plus loin, `widening` ou une liste courte plus courte |

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

## 4. Ce qu'il vaudrait la peine de mettre en commun

La règle de la lib : **un projet le prouve d'abord, la lib le reprend ensuite**, mesuré sur les mêmes scénarios
qu'une règle simple, avec son intervalle.

| Quoi | Pour qui | Quand | Pourquoi |
|---|---|---|---|
| **beam search** (`expand`, `score`, `width`, `deadline`, une quarantaine de lignes) | CodinGame | au premier défi qui s'y prête | l'outil le plus cité des post-mortems pour un jeu presque déterministe ; inutile pour nos projets, où le hasard (les durées, les arrivées) appelle des scénarios |
| **PIBT** (un pas pour toutes les unités, priorité à la bloquée) | l'entrepôt d'abord, puis la cuisine et les jeux à plusieurs unités | quand l'entrepôt grandit : plus de robots, des plans plus larges | des centaines d'unités en millisecondes ; à mesurer contre l'A* coopératif sur les mêmes journées |
| **Smitsimax / UCT découplé** | CodinGame, coups simultanés | au premier défi de ce genre | notre ISMCTS fait jouer un acteur après l'autre |
| **la réutilisation de l'arbre** d'un tour à l'autre (`reuse` de Lopin) | CodinGame, Lopin | au premier défi | les itérations du tour d'avant sont gratuites ; à mesurer, Lopin ne l'a pas départagée |
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

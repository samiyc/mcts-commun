# Les algorithmes de recherche : ceux de la lib, les autres

Sami (1/11/2026) : un tableau des algorithmes de recherche, dans la lib ou non, avec leur champ d'application, là où
chacun bat les autres, leurs points forts et faibles, le temps qu'ils demandent et ce qu'ils consomment. Les chiffres
viennent des mesures des projets ([`recherche.md`](recherche.md) § 6) ; les réglages de ceux de la lib sont dans
[`reglages.md`](reglages.md) et [`recherche.md`](recherche.md) § 1.

## 1. Qui fait quoi

| Algorithme | Dans la lib ? | Champ d'application | Là où il bat les autres | Qui s'en sert |
|---|---|---|---|---|
| **DFS** (profondeur d'abord, retour arrière) | non | énumérer toutes les solutions d'un petit arbre ; puzzles, contraintes | la mémoire : il ne garde que le chemin en cours | lopin, à sa façon : son solveur exact de fin de partie |
| **BFS** (largeur d'abord) | **oui**, sur la grille : `createDistances` (les distances au sol vers une cible), `grid/reach.js` (une cible atteignable ?) | plus court chemin quand chaque pas coûte 1 ; distances d'une cible à toutes les cases | le plus simple et le plus sûr quand tous les pas coûtent pareil ; une passe donne les distances de toutes les cases, gardées ensuite | cuisine et entrepôt (`direct`), A* (filtre des cibles hors d'atteinte) |
| **Dijkstra** | non | plus court chemin à coûts variables, sans heuristique | des coûts inégaux sans bonne heuristique | personne : nos pas coûtent tous 1 |
| **A\*** dans l'espace et le temps, coopératif (Silver 2005) | **oui** : `astar`, `createReservations` | trajets de plusieurs unités qui ne doivent ni se croiser ni s'échanger de case | un chemin optimal en explorant peu, grâce à l'heuristique ; l'attente sur place et les réservations des autres | entrepôt, cuisine |
| **CBS** (Conflict-Based Search, plusieurs agents à la fois) | non | trajets de plusieurs agents, optimaux ensemble | l'optimum de tous à la fois, là où l'A* coopératif fige l'ordre des unités | personne ; piste de [`recherche.md`](recherche.md) § 3 si l'ordre des unités coûte cher |
| **Minimax, alpha-bêta** (négamax) | non | jeux à deux, information complète, à somme nulle, avec une bonne évaluation | la tactique exacte à courte profondeur ; l'alpha-bêta élague la moitié de l'arbre ou plus | lopin, en fin de partie (son solveur) ; ses essais de « minimax implicite » dans le MCTS ont été négatifs |
| **Expectimax** | non | jeux à hasard (dés, pioche) où l'on peut énumérer les tirages | une espérance exacte quand le hasard a peu de branches | personne |
| **Monte-Carlo à plat** | de fait : `search` à `depth: 1` | comparer quelques coups par des parties jouées jusqu'au bout | rien n'est à construire : un `rollout` suffit ; une bonne base de comparaison | les règles des projets, comme témoin |
| **MCTS** (UCT) | **oui** : `search`, sur un seul monde (`sample` qui ne tire rien) | jeux et décisions séquentielles sans bonne évaluation ; information complète | l'absence d'évaluation : le `rollout` la remplace ; il s'arrête à tout moment avec un coup | codingame (Ultimate Tic-Tac-Toe, 1/11) |
| **ISMCTS** (Cowling, Powley et Whitehouse 2012) | **oui** : `search`, son cœur ; `common`, `widening`, `earlyStop` | information cachée ou futur incertain : cartes cachées, arrivées de patients, commandes à venir | décider sans connaître le monde : chaque itération tire un monde possible ; les mondes communs comparent deux coups sur les mêmes tirages | lopin, urgences, cuisine, entrepôt |
| **Recherche en faisceau** (beam search), et faisceau local | **oui** : `createBeam` (`group`, `perGroup`) | planifier ses propres coups sur plusieurs tours quand l'adversaire se modélise mal ou peu | la profondeur à budget fixe : 14 tours en 50 ms ; aucune allocation | codingame (Hypersonic) |
| **Escalade** (hill climbing, mutations et relances) | **oui** : `createClimb` | optimiser un plan de nombres continus (angles, poussées) d'un tour à l'autre | les plans continus, où un arbre de coups n'a pas de sens ; reprend le plan du tour d'avant | codingame (Mad Pod Racing) |
| **CMA-ES** (Hansen) | **oui** : `createCmaes` (13/11) | régler des nombres continus, de 2 à une cinquantaine, sans gradient : les poids d'une note, les paramètres d'une règle | apprend quels gènes bouger ensemble : une vallée en biais où l'escalade tâtonne ; aucun réglage à faire | personne encore ; raquette et codingame (tryangle-catch) d'abord |
| **Le programme quadratique** (l'ensemble actif dual, Goldfarb et Idnani, 1983) | minimise un coût quadratique ou linéaire sous des égalités, des inégalités et des bornes, et rend les multiplicateurs (les prix) | les problèmes convexes de quelques centaines de variables, exacts, dont peu de contraintes lient | reseau (la répartition, ses prix nodaux), circuit (la courbure minimale, P4). **Dans la lib depuis le 14/11** : `qp` (README, « Un programme quadratique ») |
| **Recuit simulé** | non | comme l'escalade, quand elle reste coincée sur un optimum local | sortir d'un optimum local en acceptant parfois pire | personne ; l'escalade de la lib relance des plans frais à la place |
| **Algorithme génétique** (RHEA, population) | non (30/10 : des conseils à codingame, pas de module) | plans continus ou combinatoires, plusieurs bonnes solutions à croiser | garder plusieurs pistes vivantes et les croiser | personne ; l'escalade a suffi à Mad Pod Racing |
| **Glouton, règle de Smith** | **oui** : `smithOrder`, `nextJob`, `planNight` | ordonnancer des jobs sur des fils : le plus de poids par minute d'abord | optimal pour une machine et des poids (Smith 1956) ; instantané | la file `mcts-backlog` |
| **La course aux configurations** (F-race, irace) | **oui** : `raceStep`, `mcts-race` (13/11) | régler une règle ou un bot : N variantes, les mêmes graines, la battue écartée en cours de route | moins de parties que des séries fixes quand des variantes sont nettement moins bonnes ; le risque tenu sur toute la course | personne encore ([`course.md`](course.md)) |
| **Remplissage EASY** (backfilling des grappes de calcul) | **oui** : `node/queue/fill.js` | démarrer un petit job dans un trou sans retarder le suivant | remplir les fils libres sans jamais retarder le job en tête | la file `mcts-backlog` (31/10) |

## 2. Ce qu'ils coûtent

« Court » veut dire un tour de jeu (50 à 100 ms), « long » un job de la file (des minutes à des heures).

| Algorithme | Points forts | Points faibles | Temps de calcul | CPU | RAM |
|---|---|---|---|---|---|
| **DFS** | exhaustif, presque sans mémoire, simple | exponentiel ; sans élagage, inutilisable au-delà de petits arbres | court seulement si l'arbre est petit | tout ce qu'on lui donne | **très faible** : la profondeur |
| **BFS** | optimal à pas égaux ; une passe pour toutes les cases | explore dans toutes les directions | **très court** sur une grille : quelques µs à un plan de 40 × 21 | faible | une case par état vu ; les tableaux typés de la lib sont gardés d'un appel à l'autre |
| **Dijkstra** | optimal à coûts variables | plus lent qu'A* dès qu'une heuristique existe | court | moyen | un nœud par état vu |
| **A\* espace-temps** | optimal, explore peu ; attente et réservations | une cible inaccessible fait explorer jusqu'à l'horizon ; l'ordre des unités compte | 3 µs (trajet court) à 130 µs (entrepôt, 116 nœuds) l'appel au banc ; 29 à 56 % d'une journée d'entrepôt | moyen à fort selon les échecs | un nœud par état exploré, et la table des réservations |
| **CBS** | optimal pour tous les agents | exponentiel dans le nombre de conflits | long dès que les conflits se multiplient | fort | un arbre de contraintes |
| **Minimax, alpha-bêta** | exact à sa profondeur ; déterministe | il faut une évaluation ; le facteur de branchement le borne ; rien pour l'information cachée | court avec l'approfondissement itératif, qui rend un coup à tout moment | fort, un fil (le parallélisme est difficile) | **faible** : la profondeur, plus une table de transposition si on en veut une |
| **Expectimax** | une espérance exacte | encore plus exponentiel que minimax ; pas d'élagage simple | court seulement à faible profondeur | fort | faible |
| **Monte-Carlo à plat** | trivial à écrire, aucune évaluation | ne voit pas la riposte : chaque coup est jugé sur des suites au hasard | court ou long, à volonté | proportionnel au budget | **très faible** |
| **MCTS (UCT)** | aucune évaluation nécessaire ; s'arrête à tout moment ; se concentre sur les bons coups | les rollouts au hasard trompent sur les jeux tactiques ; la lib est générique : 87 000 itérations par seconde sur Ultimate Tic-Tac-Toe, dont un quart dans les tirages, quand un UCT à tableaux typés ferait 3 à 4 fois plus (codingame, 1/11) | court (un tour) comme long (un job) | fort : il prend tout le budget | **croît avec les itérations** : un nœud et une Map d'enfants par coup essayé |
| **ISMCTS** | décide sous l'incertitude, sans connaître le monde ; les mondes communs réduisent le bruit des comparaisons | chaque itération tire et copie un monde : 0,33 ms (urgences) à 13 ms (entrepôt) l'itération ; la fusion des stratégies (« strategy fusion ») | **long** surtout : des secondes par décision dans les jobs | fort ; le parallélisme se fait par jobs ou par workers, pas dans la recherche | l'arbre, plus un monde par itération ; en mondes communs, chaque monde tiré une fois puis copié (`copy`) |
| **Faisceau** | profondeur garantie à budget fixe ; aucune allocation ; le faisceau local garde la diversité | glouton par couche : une bonne suite qui commence mal disparaît ; modélise mal un adversaire | **court** : 4,4 ms le tour au banc, 50 ms pour 14 tours sur Hypersonic | moyen, borné par `width × actions` | **fixe**, réservée une fois : `width` états |
| **Escalade** | très rapide ; reprend le plan d'avant ; aucune allocation | optimum local ; il faut une bonne fonction de score | **très court** : 0,09 ms pour 1 500 plans au banc | faible à moyen (c'est la simulation du plan qui coûte) | **fixe** : deux plans |
| **CMA-ES** | suit les vallées en biais ; ses réglages sont donnés ; `ask`/`tell` et un état en JSON pour régler par la file | un seul optimum à la fois (une population plus grande pour les paysages à bosses) ; des gènes à ramener à une même échelle | **court** : 1 à 25 µs par plan en plus du score, de 6 à 50 gènes | celui du score | n² nombres : la covariance |
| **Recuit simulé** | sort des optima locaux | un calendrier de température à régler | court comme long | comme l'escalade | **fixe** |
| **Génétique** | diversité, croisements | beaucoup de réglages ; plus lent à converger que l'escalade sur un tour court | plutôt long ; possible en court avec une petite population | moyen à fort | la population |
| **Glouton de Smith** | instantané, optimal pour une machine | ignore les fils en parallèle et les prérequis (la lib les ajoute à part) | **instantané** | négligeable | négligeable |
| **Remplissage EASY** | ne retarde jamais le job en tête | dépend des durées estimées : une estimation trop courte retarde quand même | **instantané** | négligeable | négligeable |

## 3. Lequel choisir

- **Le monde est caché ou le futur est incertain** (cartes, patients, commandes) : l'**ISMCTS** de la lib (`search`),
  en mondes communs pour comparer deux coups sur les mêmes tirages. C'est le cas de lopin, des urgences, de la
  cuisine et de l'entrepôt.
- **Un jeu à information complète, à deux, avec une bonne évaluation** : minimax et alpha-bêta. **Sans évaluation** :
  le MCTS de la lib marche tel quel (Ultimate Tic-Tac-Toe, 1/11), mais un UCT spécialisé ferait 3 à 4 fois plus
  d'itérations (voir § 4).
- **Ses propres coups sur plusieurs tours, en 50 à 100 ms** : le **faisceau** (`createBeam`), local si une seule
  famille de coups envahit le faisceau.
- **Un plan de nombres continus** (des angles, des poussées) : l'**escalade** (`createClimb`).
- **Des unités sur une grille** : **A\*** coopératif (`astar`, `createReservations`), avec `direct`
  (`createDistances`) quand la plupart des trajets sont libres.
- **Des jobs sur des fils** : la file `mcts-backlog` (Smith, prérequis, remplissage EASY).

## 4. Ce qui pourrait entrer dans la lib

- **Un UCT pour l'information complète** (codingame, 1/11) : des enfants en tableaux typés, des coups entiers, ni Map
  ni clé, l'échéance lue toutes les 64 itérations, l'arbre gardé d'un tour à l'autre. Le profil d'Ultimate
  Tic-Tac-Toe : `candidates`, `select` et `step` font 49 % du temps, les tirages 23 %. L'API `Problem` ne
  changerait pas. À décider (Sami) : rien n'est bloqué, le bot joue avec la lib telle quelle.
- **Un alpha-bêta générique** : seulement si un projet à information complète avec une évaluation arrive.
- **CBS** : seulement si l'ordre fixe des unités de l'A* coopératif coûte des plats ou des colis (aucun signe à ce
  jour : `astar.parkedTarget` vaut 0 chez entrepôt, le 31/10).
- **`climb` sur K scénarios, avec une coupe et un scénario ajouté en cours de tour** (codingame, 10/11) : fall-challenge-2026 l'a prouvé
  dans son propre `score` (7 réponses adverses en moyenne ; la coupe après la première, +72 % de plans ; la meilleure réponse de l'autre
  ajoutée à mi-tour, 52,6 % sur 1 500) ; economie posait la même question le 6/11. Une option de `createClimb`, à décider (Sami) :
  [`post-mortem-fall-2026.md`](post-mortem-fall-2026.md) § 6.
- **Le faisceau, rien à ajouter** (codingame, 10/11) : le post-mortem d'Hypersonic (10e / 783) confirme en chiffres ce que la lib a déjà :
  la profondeur jusqu'à l'échéance (remettre une profondeur fixe perd 36 %) et le faisceau local (241e → 22e) ; rien d'autre dans le faisceau
  n'a payé (largeur, plafond par case, quotas de racine). Ce qui reste est du côté du problème : une prudence intermédiaire pour l'adversaire
  en hypothèse. [`post-mortem-hypersonic.md`](post-mortem-hypersonic.md).
- **Déjà essayés, négatifs** : chez lopin, RAVE, PUCT et le minimax implicite dans le MCTS
  ([`lopin/docs/1.3-to-oracle-shift.md`](../../lopin/docs/1.3-to-oracle-shift.md)) ; l'A* sur tableaux typés dans la
  lib, pas plus rapide (30/10, [`recherche.md`](recherche.md) § 6).

## 5. Côté recherche opérationnelle et industrie : les pistes de niche

Sami (12/11/2026) : des algorithmes moins tournés vers les jeux, plus vers la recherche et l'industrie. La lib couvre
le jeu et le contrôle en temps réel (MCTS, faisceau, escalade) ; il lui manque des familles bien établies en recherche
opérationnelle, presque absentes de CodinGame. Aucun n'entre dans la lib avant qu'un projet en ait besoin et que la
mesure le justifie (la règle du § 4).

| Algorithme | Ce qu'il fait | Là où il gagne | Pour qui |
|---|---|---|---|
| **La course aux configurations** (*racing* : F-race, irace, Birattari et López-Ibáñez) | compare N variantes graine après graine, par un test apparié, et élimine une variante dès qu'elle est battue | le réglage de paramètres ; c'est ce que la file fait à la main, rendu automatique | tous : les réglages de feux, les règles d'economie, raquette. **Dans la lib depuis le 13/11** : `race` et `mcts-race` ([`course.md`](course.md)), ce qu'elle économise selon les écarts y est mesuré |
| **L'optimisation bayésienne** (un modèle de substitution : processus gaussien, TPE) | choisit le prochain réglage à essayer d'après les essais passés | quand une évaluation coûte des minutes, pas des microsecondes | le réglage des règles d'economie et de feux, où chaque essai est un job |
| **CMA-ES** (Hansen) | l'escalade qui apprend la forme du terrain : quels gènes bouger ensemble, et de combien | les plans continus de 5 à 100 dimensions, sans gradient | economie (déjà conseillé le 6/11), raquette, les durées de feux, la ligne de course de `circuit` (13/11). **Dans la lib depuis le 13/11** : `cmaes` (README, « CMA-ES ») |
| **ALNS** (grand voisinage adaptatif, Ropke et Pisinger 2006) | détruit 20 % d'une solution et la reconstruit, en apprenant quelles destructions et quelles reconstructions paient | la référence des tournées et de l'ordonnancement | agenda (le replanning d'une absence), entrepôt |
| **NMCS et NRPA** (le Monte Carlo imbriqué, Cazenave ; Rosin 2011) | un MCTS à un seul joueur, qui apprend une politique de tirage | des records sur des puzzles (Morpion solitaire) et les tournées avec fenêtres horaires | le cousin direct de `search` ; la piste des protéines, orpheline depuis le 6/11 |
| **MAP-Elites** (qualité-diversité, Mouret et Clune 2015) | garde la meilleure solution de chaque case d'une carte de comportements, plutôt qu'une seule meilleure | montrer des solutions *différentes* et toutes bonnes | economie (une carte chômage × dette, très visuelle), raquette (des styles de jeu) |
| **NSGA-II** (front de Pareto, Deb 2002) | optimise plusieurs objectifs sans les fondre en un score | les compromis | economie, qui refuse déjà un score unique |
| **SDDP** (programmation dynamique duale stochastique, Pereira et Pinto 1991) | gère un stock dans le temps sous incertitude, par des coupes de Benders | l'eau des barrages : l'outil des gestionnaires de réseaux électriques | le réseau électrique (`reseau`, 12/11) |

**L'escalade et le faisceau, la différence** (Sami, 12/11) : l'escalade tient **un plan complet** et le **retouche**
(un gène bougé, le plan entier simulé, gardé s'il fait mieux) ; le faisceau tient **W débuts de plan** et les
**prolonge** d'un tour, puis garde les W meilleurs. L'une pour des nombres continus, piégée par les optima locaux ;
l'autre pour des actions qu'on énumère, piégée par la myopie (un chemin qui paie tard est jeté tôt). La première est
une recherche locale, la seconde une recherche constructive.

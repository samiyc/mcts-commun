# Les réglages de la recherche, projet par projet

Sami, 28/10/2026 : « je n'ai absolument aucune idée des config ismcts sur les trois applis ; j'aimerais une vision
d'ensemble sur les configs vs lopin ». Le budget 128 venait d'être abandonné, et les pistes à essayer sont de
chercher plus profond, plus large, ou avec plus de coups à la racine.

Commun a lu les valeurs par défaut dans le code de chaque dépôt le 28/10 au soir (celles que la file mesure). Chaque
projet a ensuite relu sa colonne et l'a corrigée par le tableau des sessions, avec l'accord de Sami (20 h 51 à 20 h 54).

## Le tableau

| | **lopin 1.2** (la référence ; l'Expérimental est la 1.3 depuis le 30/10, les mêmes réglages de l'arbre) | **cuisine** | **entrepôt** (plans, ligne, usine) | **urgences** (garde, parcours) |
|---|---|---|---|---|
| Moteur | son propre ISMCTS (`lopin/src/sim/mcts/ismcts.js`) | `search` de commun | `search` de commun | `search` de commun |
| Mondes | un monde tiré par itération, **pas communs** aux coups de la racine | communs, tirés une fois puis copiés | communs | communs, tirés une fois puis copiés (`copy`) |
| Itérations | **2 000** | **64** | **64** | **100** (garde, box) ; **50** (les sept autres décisions du parcours) |
| Profondeur de l'arbre | **5** | **2** | **2** | **2** |
| Coups gardés à la racine | **8** | **4** | **5** | **4** (garde : + attendre, + personne) ; **tous** pour les autres décisions |
| Coups gardés plus bas | **7** | 4 | 5 | les mêmes qu'à la racine |
| Élargissement progressif | **non** (seul l'Oracle light, `pwl=3` à 10 000) | non | non | non |
| Exploration (UCB) | **0,7** | **0,3** | **0,3** | **0,7** |
| Arrêt précoce | non | **oui** (`earlyStop`) | **oui**, + `calm` sur les lignes | **non** |
| Horizon d'un monde | la fin de la partie | 60 tours (le banquet : au moins le dernier envoi) | la journée (entrepôt) ; 180 tours (ligne) ; 360 (usine) | 120 min (240 : Plan blanc, HET) |
| Déroulé | **un vrai bot** (le cœur du Stratège, `stfig6`), à la règle `final` | la règle du monde : la plus rapide, la table, le rétroplanning | la liste (entrepôt) ; la plus proche (ligne) ; la liste et le kanban (usine) | la règle de référence de chaque décision |
| Fin calculée exactement | **oui**, sous 12 cartes (`exact=12`) | non | non | non |
| Score | gagné ou perdu | `0,5 + (valeur − base) / 3`, borné à [0, 1] | `0,5 + (base − coût) / (20 × camions)` ; lignes, usine : `/ 20` sur les tours d'arrêt | `échelle / (échelle + coût)` |
| Temps par décision (file du 28/10, sous charge) | ~5 s par coup sur un fil (173 s la partie de 35 coups) | 70 à 280 ms | 127 à 869 ms (entrepôt) ; 58 à 203 (lignes) ; 402 (usine) | 16 à 32 ms (garde) ; 125 à 240 (box) ; 13 à 155 (les autres, à 50) |

## Le détail, projet par projet

### lopin
- **Pas de mondes communs.** `+crn=1` (CommonDeals) réduisait le regret de la racine à 400 itérations, mais à 2 000 il
  a fait 50,7 % (de 48,2 à 53,2) : écarté. Ce qui a payé un peu, ce sont **deux arbres indépendants** (`trees=2` :
  54,6 % puis 51,4 % sur 1 000 parties). C'est la différence la plus nette avec les trois projets.
- **L'élargissement progressif ne change rien à 2 000 itérations** (`pw=1` 51,1 %, `pw=2` 47,8 %, 51,2 % sur 1 180
  parties). Il ne paie qu'autour de 20 000.
- **Le déroulé joue la règle `final`** : les bornes ne se règlent qu'à la fin, dans l'ordre où elles se sont remplies.
  Prouver les revendications à chaque coup simulé (`claim-end`, la règle de la partie) coûtait un tiers des
  itérations. Les deux donnent le même vainqueur dans 91 % des parties ; lopin mesure en ce moment les fins « sûres »
  perdues.

### cuisine
- **Les mondes** retirent les commandes à venir, l'heure des coursiers, les pauses du cuisinier, les pannes, et le
  modèle de l'humain (tiré parmi `HUMANS`, ou le vrai avec l'option `human`).
- **L'arbre** : la décision de ce robot, puis celle du robot libre suivant.
- **Les coups** : chaque commande ouverte, plus « attendre » là où un plat peut mourir au passe (tables, banquet,
  livraison). Une seule commande et rien à attendre : prise sans recherche. Le `shortlist`, dans cet ordre : le choix
  de la règle du déroulé, attendre, le plat le plus rapide, la plus ancienne, la caisse la plus proche.
- **Le score** : les plats servis à temps, plus ½ pour ceux encore dans les temps à l'horizon. La base est la valeur
  moyenne de la règle du déroulé sur 4 mondes tirés. Un plat de plus ou de moins vaut 1/3.
- **Mesurées** : `earlyStop` (27/10, adopté) ; `budget=128` et `grace=30` (28/10, écartés par Sami).

### entrepôt
- **Le score** : dans l'entrepôt, le coût est l'attente des camions plus un quart du tour moyen de livraison ; sur la
  ligne et à l'usine, les tours d'arrêt de la ligne. Partout, la base est la moyenne de 4 déroulés de la règle de
  référence, tirés avant la recherche (6 % du temps dans l'entrepôt, 13 % à l'usine).
- **Sans recherche** : un seul coup ouvert ; à l'usine, quand le déroulé n'arrête la ligne dans aucun monde tiré
  (l'équivalent de `calm`, toujours actif).
- **Le `shortlist`** : entrepôt, les 3 plus proches, la première de la liste, la plus lointaine ; ligne, les 2 plus
  proches, la plus ancienne, les 2 couvertures les plus courtes ; usine, les 2 premières de la liste, les 2 plus
  proches, les 2 références que la ligne épuisera le plus tôt.
- **Mesurées** : `budget=128` (28/10, non adopté : une journée perdue sur le plan de Sami) ; `legHorizon` (1 à 4 %
  plus rapide, jobs annulés le 28/10).

### urgences
- **Les coups** : 4 pour la garde et les box, parmi les favoris des règles couleur, échéance et arrivée. Les sept
  autres décisions gardent tous leurs coups (`whole`) : 2 pour les pauses, le Plan blanc et le HET (maintenant ou plus
  tard) ; tous les candidats pour les lits, la SAUV, l'interne et les files.
- **L'horizon** : un monde est joué jusqu'à ce que les patients qui attendent ou arrivent dans l'horizon soient pris
  (les lits : jusqu'à ce que ceux qui attendent un lit l'aient ; l'interne, le Plan blanc et le HET : jusqu'au bout).
- **Le déroulé** : la couleur pour les box et les files, la décision la plus ancienne pour les lits, « au calme » pour
  les pauses, la tâche due la première pour l'interne, le seuil pour le Plan blanc et le HET, « jamais » pour la SAUV.
- **Le score** : l'échelle est le coût moyen de quelques déroulés à la règle (3 pour le parcours, au moins 20 ; 6 pour
  la garde), donc environ ½ pour la règle. Le coût : le retard au niveau du moment, plus ce que comptent les ajouts
  allumés (l'attente d'un lit, les lits du HET, les heures de médecin rappelées, les décès).
- **Les mondes** tirent les arrivées à venir (les taux de l'heure, l'épidémie), et à nouveau la gravité des patients
  connus pas encore vus.

## Ce qui saute aux yeux

- **Les trois projets cherchent 20 à 40 fois moins que lopin**, sur un arbre de 2 décisions au lieu de 5. C'est voulu :
  chaque journée compte des centaines de décisions, et la recherche doit battre une règle simple à temps égal.
- **Les trois projets tirent des mondes communs, lopin non.** Chez lopin, les mondes communs n'ont rien gagné à 2 000
  itérations ; deux arbres indépendants, un peu. Dans les projets, c'est ce qui rend la marge par paires
  (`closeCall`) possible.
- **Une seule largeur pour tout l'arbre.** Le `shortlist` de chaque projet sert à la racine et plus bas, avec la même
  largeur : donner plus de coups à la racine élargit aussi chaque nœud. Lopin les sépare (8 et 7).
- **Le déroulé est la règle de référence partout sauf chez lopin**, où c'est un bot qui joue bien.
- **L'exploration est à 0,3 chez cuisine et l'entrepôt**, avec `earlyStop` ; à 0,7 chez urgences, sans.

## Ce que disent les diagnostics du 28/10, sur les trois pistes de Sami

- **Plus profond** : `shallow` (l'arbre n'atteint pas sa profondeur) vaut 8 % au plus. À 2 décisions, l'arbre va déjà
  au bout ; plus profond ne sert que si une décision pèse sur plus de 2 suivantes, et coûte des itérations.
- **Plus de coups à la racine** : `closeCall` va de 37 à 87 % chez cuisine, de 63 à 94 % dans l'entrepôt, de 70 à
  81 % sur la garde et les box d'urgences (4 à 52 % sur ses autres décisions). Les deux premiers coups se valent déjà
  souvent ; un candidat de plus ne change le résultat que si la règle de référence oublie souvent le bon coup.
- **Plus large plus bas (l'élargissement progressif)** : chez lopin, rien à 2 000 itérations ; il ne paie qu'autour de
  20 000. Aucun projet n'en est là.
- **Le banquet de cuisine** (`flatScore` 38 à 58 %) : les mondes y finissent tous de même. Une note graduée
  (`grace=30`) y a été mesurée le 28/10 et y perd des plats (la grande brigade : −2,37, de −3,69 à −1,04) ; 128
  itérations n'y font rien. Sami : la note graduée reste désactivée, le budget reste à 64.

## Ce que commun a ajouté (28/10, `ef28dfd`)

- **Une largeur de racine à part** : `shortlist(world, moves, { root })` reçoit `root: true` à la racine. Un projet
  peut garder 8 coups à la racine et 4 plus bas, comme lopin. Rien ne change pour qui ne s'en sert pas.
- **Le rang du coup joué** dans le `shortlist` de la racine (`result.rank`, `{ played, of }`) : si les derniers rangs
  ne sont presque jamais joués, plus de coups à la racine n'y gagnera rien.
- **`closeCall` sur une recherche arrêtée par `earlyStop`** dit « coups presque équivalents », avec `settled: true`.
- Reste à essayer : **deux arbres indépendants** (`trees`, ce qui a payé chez lopin).

## Le palier à mesurer (Sami, 28/10)

Sami : « les valeurs sont très basses en comparaison de lopin ; trouver les bons réglages pour un palier raisonnable,
qui ne prenne pas trop de temps à tester ». Quatre réglages, un à la fois puis ensemble, chacun contre les réglages
d'aujourd'hui, **par paires sur les mêmes journées ou services**, avec `diagnose` :

| Variante | Ce qu'elle essaie | Budget | Racine | Plus bas | Profondeur | Élargissement |
|---|---|---|---|---|---|---|
| **A** | aujourd'hui | 64 (urgences : 100) | 4 ou 5 | 4 ou 5 | 2 | non |
| **B** | plus de budget | ×4 | = | = | 2 | non |
| **C** | plus de candidats à la racine | = | 8 | = | 2 | non |
| **D** | plus profond | ×2 | = | = | 3 | non |
| **E** | tout ensemble (« lopin léger ») | ×4 | 8 | +1 | 3 | 1 (progressif) |

- **Pour chaque variante** : le gain par paires avec son intervalle (plats à temps, journées, retard), le temps par
  décision contre A, et ce que dit `diagnose` (`closeCall` dont `settled`, `shallow`, le rang du coup joué).
- **Le temps** : B et E coûtent jusqu'à 4 fois plus par décision (moins avec `earlyStop`). Chaque projet choisit ses
  journées ou services pour tenir dans **1 h de la machine entière** au plus, et met l'estimation dans ses jobs.
- **Ce qu'on en retient** : un réglage gagne si l'intervalle de son gain est au-dessus de zéro ; Sami décide ensuite
  avec le prix en temps. Si E gagne et pas les autres, c'est la combinaison qui compte. Si rien ne gagne, les
  réglages d'aujourd'hui suffisent pour ces problèmes, et la piste suivante est ailleurs (le déroulé, le score).

## Ce que le palier a montré (28/10 au soir)

La file du palier a tourné de 22 h 14 à 0 h 03 : 149 jobs, aucun échec. Les chiffres et les intervalles viennent de
chaque projet. Le détail est dans leurs dépôts :
- cuisine : `docs/mesures-palier-28-10.md` (`fb47f14`) ;
- l'entrepôt : `docs/outillage.md`, « Le palier de réglages » (`b6fcfe2`) ;
- urgences : `docs/parcours-ajouts.md`, « Le palier de réglages » (`6ef2ed0`).

| | B (budget ×4) | C (8 à la racine) | D (profondeur 3) | E (tout) |
|---|---|---|---|---|
| **cuisine** (13 réglages, 30 services) | gagne seulement aux tables de la grande brigade (+2,7 plats) | rien, et sans coût | rien (peut-être −1,3 aux tables) | **5 réglages sur 13**, tous en positif : 1,5 à 2,5 % à la carte, +3 plats aux tables |
| **l'entrepôt** (6 plans, 8 lignes, l'usine) | **l'assemblage** : 16,7 tours de moins, 26 journées sur 30 | ne gagne nulle part, perd aux quais | **les quais** : 36,4 tours de moins, 29 journées sur 30 | gagne moins que D aux quais et que B à l'assemblage |
| **urgences** (garde, box, HET) | 3 à 7 % de mieux, sûr sur la garde seulement | **pendant l'accident** : garde −16 %, box −5 % | la garde d'un jour ordinaire : −9 % | **pendant l'accident** : garde −19 %, box −13 % |
| **Le temps d'une décision, contre A** | 3 à 4 fois | 1 fois | 1,6 à 2 fois | 3,3 à 4 fois |

Rien n'est prouvé sur les lignes et à l'usine de l'entrepôt. Sur le HET d'urgences (deux coups, un choix net), aucun
gain n'est prouvé, mais D y fait sûrement moins bien que A : +70 (+14 à +125) sur 42 347. Il obtient plus de lits (4,7
contre 3,9), qui lui coûtent plus qu'ils ne rapportent (urgences, 29/10). Sur
le plan de Sami, toutes les variantes perdent 2 à 4 tours, mais ses 30 journées sont presque une seule situation
répétée : l'intervalle y surestime la généralité.

**Ce qu'on en lit** :
- **Aucun réglage ne gagne partout.** Chaque projet gagne par un levier différent, parfois par décision. Les valeurs
  par défaut de la lib ne bougent pas, et celles des projets non plus tant que Sami n'a pas tranché.
- **Plus de coups à la racine ne paie que chez urgences, et seulement les jours chargés.** Pendant l'accident, C joue
  un des coups 5 à 8 dans 31 à 39 % des recherches : la liste courte de 4 écartait souvent le bon. Un jour ordinaire,
  ce n'est que 6 à 8 %. Chez l'entrepôt, le coup joué change souvent avec C (rang 3 ou plus : 21 % chez A, 44 % chez
  C), sans rien gagner.
- **Le budget seul départage mieux les mêmes coups**, sans changer le rang joué (urgences : `closeCall` de 78 à
  64 %).
- **Le rang du coup joué dit si la liste courte est en cause**, mieux que `closeCall`, qui était haut partout.
- **Chez lopin, la largeur n'est pas en cause** (ses jobs `sure-lost-moves`, le même soir). Dans 34 positions sur 76
  « gagnées à coup sûr » puis perdues, un autre coup gagnait, et c'était le 2e en visites dans 19 cas. C'est la règle des
  donnes (`final` contre `claim-end`) qui classait mal des coups déjà vus.
- **Le prix** : 2 à 4 fois le temps pour quelques pour cent, sauf C chez urgences, gratuit.

**Les suites proposées, à décider par Sami** :
- **cuisine** : A ou E, après une confirmation sur d'autres graines. Corriger les plats qui meurent au passe : 11,7
  par service aux tables de la grande brigade, un point faible de son modèle.
- **l'entrepôt** : rejouer une journée du plan de Sami (A contre B). Confirmer D aux quais et B à l'assemblage sur des
  journées plus variées.
- **urgences** : C à budget ×2 pendant l'accident et dans les deux autres hôpitaux, pour voir s'il rejoint E pour la
  moitié du temps.
- **lopin** : jouer à `claim-end` dans l'arbre quand la pioche est basse, ou ne rien changer.

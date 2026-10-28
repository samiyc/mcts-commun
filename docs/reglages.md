# Les réglages de la recherche, projet par projet

Sami, 28/10/2026 : « je n'ai absolument aucune idée des config ismcts sur les trois applis ; j'aimerais une vision
d'ensemble sur les configs vs lopin ». Le budget 128 venait d'être abandonné, et les pistes à essayer sont de
chercher plus profond, plus large, ou avec plus de coups à la racine.

Commun a lu les valeurs par défaut dans le code de chaque dépôt le 28/10 au soir (celles que la file mesure). Chaque
projet a ensuite relu sa colonne et l'a corrigée par le tableau des sessions, avec l'accord de Sami (20 h 51 à 20 h 54).

## Le tableau

| | **lopin 1.2** (le bot Expérimental) | **cuisine** | **entrepôt** (plans, ligne, usine) | **urgences** (garde, parcours) |
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

## Ce que commun pourrait ajouter

- **Une largeur de racine à part** : `shortlist(world, moves, { root })`, pour qu'un projet garde 8 coups à la racine et
  4 plus bas, comme lopin. Rien ne change pour qui ne s'en sert pas.
- **Le rang du coup joué dans le `shortlist`**, compté par `diagnose` : s'il est presque toujours le premier, la
  largeur ne sert à rien.
- **Deux arbres indépendants** (`trees`, ce qui a payé chez lopin), à essayer sur un projet sans mondes communs, ou en
  comparant les deux.

Rien n'est fait : c'est à Sami de décider, puis à chaque projet de mesurer, par paires, à temps égal.

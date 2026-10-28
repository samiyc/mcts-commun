# Les réglages de la recherche, projet par projet

Sami, 28/10/2026 : « je n'ai absolument aucune idée des config ismcts sur les trois applis ; j'aimerais une vision
d'ensemble sur les configs vs lopin ». Le budget 128 venait d'être abandonné, et les pistes à essayer sont de
chercher plus profond, plus large, ou avec plus de coups à la racine.

Lu dans le code de chaque dépôt le 28/10 au soir (les valeurs par défaut, celles que la file mesure).

## Le tableau

| | **lopin 1.2** (le bot Expérimental) | **cuisine** | **entrepôt** (plans, ligne, usine) | **urgences** (box, parcours) |
|---|---|---|---|---|
| Moteur | son propre ISMCTS (`lopin/src/sim/mcts/ismcts.js`) | `search` de commun | `search` de commun | `search` de commun |
| Mondes | un monde tiré par itération, un seul arbre | communs (`common: true`) : le k-ième monde est le même pour chaque coup de la racine | communs | communs |
| Itérations | **2 000** (`@2000`) | **64** (`budget`) | **64** | **100** |
| Profondeur de l'arbre | **5** | **2** | **2** | **2** |
| Coups gardés à la racine | **8** (`candidates`) | **4** (`width`) | **5** | **4** |
| Coups gardés plus bas | **7** (`widen`) | 4, les mêmes que la racine | 5 | 4 |
| Élargissement progressif | non (essayé : `pw`, `pwl=3` pour l'Oracle) | non (`widening: 0`) | non | non |
| Exploration (UCB) | **0,7** | **0,3** | **0,3** | **0,7** |
| Arrêt précoce | — (pas dans le moteur de la 1.2) | **oui** (`earlyStop`) | **oui** (+ `calm` sur les lignes) | **non** |
| Déroulé (la fin du monde jouée) | **un vrai bot** : le Stratège (`core=stfig6`) | une règle simple : celle du monde (la plus rapide, la table, la planification) | une règle simple : l'ordre de la liste | une règle simple : la couleur, ou les règles du parcours |
| Fin calculée exactement | **oui**, sous 12 cartes (`exact=12`) | non | non | non |
| Score | gagné ou perdu | `0,5 + (valeur − base) / 3`, borné à [0, 1] (`spread`) | `0,5 + (base − coût) / 20 par camion` | `échelle / (échelle + coût)` |
| Temps par coup | 2 à 4 s | 127 à 869 ms la décision (entrepôt, 28/10) ; des services en secondes (cuisine) | idem | ~200 ms la recherche (urgences) |

## Ce qui saute aux yeux

- **Les trois projets cherchent 20 à 30 fois moins que lopin**, sur un arbre de 2 coups au lieu de 5. C'était voulu :
  chaque décision d'une journée en compte des centaines, et la recherche doit battre une règle simple à temps égal.
- **Une seule largeur pour tout l'arbre.** Le `shortlist` de chaque projet sert à la racine et plus bas, avec la
  même `width`. Donner plus de coups à la racine élargit donc aussi chaque nœud. Lopin les sépare : 8 à la racine,
  7 plus bas.
- **Le déroulé est une règle simple partout sauf chez lopin**, dont le déroulé est un bot qui joue bien (le cœur du
  Stratège). Dans les projets, le déroulé joue la règle de référence, que la recherche doit justement battre.
- **L'exploration est à 0,3 chez cuisine et l'entrepôt**, et à 0,7 ailleurs. À 0,3, la recherche creuse vite le
  coup en tête : ça va avec `earlyStop`, qui s'arrête dès que ce coup ne peut plus être rattrapé.
- **Urgences n'a pas `earlyStop` par défaut.**

## Ce que disent les diagnostics de la file du 28/10, sur les trois pistes

- **Plus profond (`depth`)** : `shallow` (l'arbre n'atteint pas sa profondeur) vaut 8 % au plus chez cuisine, et
  reste aussi bas ailleurs. À 2 coups, l'arbre va déjà au bout. Le monter à 3 ou 4 ne sert que si le problème a des
  conséquences à plus de 2 décisions, et coûte des itérations.
- **Plus de coups à la racine** : `closeCall` est haut, de 56 à 94 % selon le plan. Les deux premiers coups se valent
  déjà. Un troisième ou un cinquième candidat ne change le résultat que si la règle de référence oublie souvent le
  bon coup : le `shortlist` le dit, en comptant combien de fois le coup joué n'est pas le premier de la liste.
- **Plus large plus bas (`widening`)** : l'élargissement progressif de commun (celui que lopin a gardé) n'a été
  essayé par aucun projet. Il ne sert qu'avec une profondeur plus grande.
- **Là où un réglage servirait le plus** : le banquet de cuisine (`flatScore` 38 à 58 %, `fewIterations` 30 à
  52 %). Le score n'y départage pas les coups. Une récompense graduée y gagnerait plus que des itérations.

## Ce que commun pourrait ajouter

- **Une largeur de racine à part** : `shortlist(world, moves, { root })`, pour qu'un projet garde 8 coups à la racine et
  4 plus bas, comme lopin. Les empreintes ne changent pas pour qui ne s'en sert pas.
- **Un compteur du rang du coup joué dans le `shortlist`** dans `diagnose` : s'il est presque toujours le premier, la
  largeur ne sert à rien.

Rien n'est fait : c'est à Sami de décider, puis à chaque projet de mesurer, par paires, à temps égal.

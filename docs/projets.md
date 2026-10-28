# Ce que chaque projet prend de la lib

Sami, 28/10/2026 : « que les clients prennent en compte les dernières évolutions et corrections de la lib commune,
et valident en local qu'il n'y a pas de gros bug ». Puis, quand tout le monde est à la page, la file de jour se lance
d'un commun accord, sur les jobs qui ont encore du sens.

Cette page est la liste à suivre. Elle se tient à jour à chaque évolution de la lib ; le détail et les chiffres sont
dans [`recherche.md`](recherche.md) (§ 6) et [`backlog.md`](backlog.md).

## L'état des projets

| Projet | Lib prise | Vérifié en local | `copy` | `direct` | Jobs en file revus | Prêt pour la file |
|---|---|---|---|---|---|---|
| cuisine | | | à mesurer | à reprendre de la lib | | |
| entrepôt | | | à mesurer | à mesurer | | |
| urgences | | | à prendre (remplace `pathway-worlds.js`) | sans grille | | |
| lopin | | | sans mondes communs | sans A* | | |
| codingame | oui (2f5554f) | 53 tests sur 53 | — | — | — | |

## 1. Prendre la lib

- Le lien `file:../mcts-commun` prend la lib telle qu'elle est sur le disque : rien à installer. Un `npm install` crée
  `npx mcts-backlog` et `npx mcts-board` s'ils manquent.
- **Node 24 LTS** remplace Node 20.10 sur la machine (Sami, 28/10). Tous les projets passent leurs tests sous Node 24,
  sauf lopin : `node --test tests/` n'y marche plus (Node lit `tests/` comme un nom de fichier), il faut un motif,
  `node --test "tests/**/*.js"`, que Node 20 ne comprend pas. Le script change donc au moment du passage. Sur une
  mesure réelle de l'entrepôt, Node 24 va 22 % plus vite. Chaque projet met à jour son CLAUDE.md (« Node 20 »).

## 2. Ce qui change sans rien changer aux résultats

Rien à faire : les mêmes chemins, les mêmes coups, les mêmes empreintes (vérifiés dans commun contre l'ancien code sur
4 000 cas tirés au hasard).

- **A\*** voit tôt une cible hors d'atteinte et n'alloue presque plus : de 7 à 20 fois plus rapide au banc.
  `astar.expanded` baisse, `astar.givenUp` monte.
- **Les réservations** ont des clés numériques. Nouvelle contrainte : une case réservée a des coordonnées entières de
  −4096 à 4095.
- **`events.clone`** ne trie plus le tas.
- **À remesurer** : les filtres faits maison avant A* (`day-reach` de l'entrepôt, `shutOut` de cuisine) deviennent en
  partie redondants. Gardez-les s'ils rapportent encore, retirez-les sinon : la mesure le dit.

## 3. Ce qu'il faut adopter

Les accords de Sami (28/10) : **la version la plus rapide partout où elle sert**, chaque projet vérifiant qu'il n'y a
pas d'écart imprévu ; **des empreintes recalculées** si le gain est réel, dans un commit à part qui dit pourquoi.

| Quoi | Pour qui | Les empreintes | Comment vérifier |
|---|---|---|---|
| `problem.copy(world)` : chaque monde commun tiré une fois, puis copié | ceux qui cherchent en mondes communs : cuisine, entrepôt, urgences | **ne bougent pas** si la copie est fidèle | la recherche avec et sans `copy`, champ par champ, sur des journées ou des services : à l'identique. Un écart veut dire une copie infidèle (un objet partagé, un flux oublié) |
| `astar(…, { direct: createDistances(plan, passable) })` : le trajet au sol d'abord, A* si une case est prise | ceux qui ont une grille : cuisine (le sien, repris par la lib), entrepôt | changent (deux chemins aussi courts) | adopté **s'il va environ 4 fois plus vite** (Sami) à résultats équivalents : mêmes plats à temps, mêmes journées à l'unité près. Au banc de commun, il ne gagne plus que 15 à 25 % sur un plan d'entrepôt, A* étant devenu rapide. Pour cuisine, les mêmes trajets que son `directPath` (4 800 trajets comparés) : ses empreintes tiennent |
| `createReservations({ capacity: 2, single })` | cuisine (deux cuisiniers par case d'allée) | changent si elle remplace `shared` | les mêmes plats à temps, aucune case réservée deux fois en plus |

## 4. Les règles de la file, rappelées

- Un test ou un essai court à côté de la file passe par `npx mcts-backlog --slot N -- commande` ; une mesure longue va
  dans la file.
- `progress()` à chaque service, journée ou vague ; des tranches de 30 min au plus ; des estimations refaites après
  les gains de vitesse (la file les apprend, mais une commande neuve se fie à la vôtre).
- Une durée se compare à charge égale : une tranche prend 2,3 fois plus de temps quand 18 jobs tournent que seule.
- La lib ne change pas pendant que la file tourne.

## 5. Avant de dire « prêt pour la file »

1. `npm test` et les empreintes passent, sous `--slot`.
2. Une courte exécution réelle (quelques journées ou services, avec la recherche) donne les mêmes résultats qu'avant,
   ou des écarts expliqués par ce que vous avez adopté. Notez le temps avant et après.
3. La trace n'a pas plus de cases réservées deux fois (`grid.overbooked`) ni d'erreurs qu'avant.
4. **Vos jobs en attente sont revus** : ceux qui ne mesurent plus rien d'utile depuis les gains sont annulés
  (`npx mcts-backlog --cancel ID`), ceux qui doivent tourner sur la nouvelle base sont refaits ou gardés, leurs
  estimations à jour.
5. Vous répondez sur le tableau, dans le fil de commun : ce qui tient, ce qui a bougé et pourquoi, le gain mesuré, le
  nombre de jobs gardés. Commun tient le tableau ci-dessus ; Sami lance la file quand tout le monde est prêt.

Tout bug trouvé dans la lib va à `commun` par le tableau, avec le cas qui le montre.

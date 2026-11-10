# Post-mortem d'Hypersonic (codingame, 10/11/2026) : ce qu'un faisceau nous a appris

Le projet `mcts-codingame`, dossier `hypersonic/` : un Bomberman de 2 à 4 joueurs, 100 ms par tour, sur le site CodinGame. Le bot Lua de Sami
(2016) était 424e / 768 en Légende ; dix soumissions en JavaScript du 28/10 au 1/11, et la v010 est **10e / 783 de Légende** (lu le 10/11), le
meilleur rang de ses bots. La version interne complète, chaque chiffre avec sa ligne : `mcts-codingame/hypersonic/docs/post-mortem.md` ; le
post pour le forum : `hypersonic/docs/post-mortem-forum.md`. Ici, ce qui concerne la lib (`beam.js`, `measure.js`) et les projets qui
prennent un faisceau (fall-challenge-2020, spring-challenge-2021, raquette, economie) ou qui mesurent une recherche contre une cible.

## 1. Le résumé chiffré

Un faisceau sur une simulation en `Uint8Array` de 576 octets par état, sans allocation ; 10 actions par état ; **500 états, 12 au plus sur une
même case** ; **la profondeur jusqu'à l'échéance** (14 à 25 tours sur le site) ; les adversaires immobiles qui posent une bombe au premier tour
simulé selon une prudence 2 → 1 → 0 ; une note (caisses, promesses, objets par rampes, attraction, place pour bouger, tempo) atténuée avec les
tours ; 85 ms, 60 de 16 h à 1 h UTC. Mesuré dans l'arène du projet sur son arbitre JS (parité 13 / 13 avec le site), par paires avec intervalle
(la mesure standard depuis le 1/11 : 1 000 parties en duel + 1 000 en 1 contre 3 par variante), puis contre le haut de la ligue par l'API
sur les mêmes seeds pour les deux versions.

| Étape | Gain mesuré | Rang |
|---|---|---|
| le faisceau, profondeur 14 | 75 / 3 / 2 contre le Lua (profondeur 10 : 65 / 7 / 8 ; largeur 300 : rien) | 265e |
| la note (tempo, caisses déjà promises) | 64 % [58 ; 70] des duels à 4 | 241e |
| **les faisceaux locaux** (12 par case) | 61 % [54 ; 68], 1,38 caisse par bombe contre 1,05 | **22e** |
| la profondeur jusqu'à l'échéance | remettre 14 : 36 % [29 ; 44] | 23e |
| l'objet bombe à 2 (une test game lue) | 60 % deux fois ; 53 % contre 32 % face au top sur l'API | 264e : **21 timeouts / 48 défaites** |
| le budget par l'heure du serveur (85 / 60 ms), la recherche +18 % | — | 17e |
| trois situations lues dans l'arène (Sami) | neutres en auto-jeu ; 61 % contre 47 % sur l'API | 14e |
| les rampes de la v10, la bombe rendue après les ordres, les grappes | 55 % [51 ; 60] en duel, rang 2,23 [2,16 ; 2,29] à 4 | **10e** |

## 2. Le faisceau : ce qui a payé, ce qui n'a rien donné

- **La profondeur paie, la largeur non**, et la profondeur se prend jusqu'à l'échéance, pas à un nombre fixe. C'est déjà dans la lib
  (`beam.run` : `depth` grand, `deadline` qui décide, la couche coupée jetée ; `recherche.md` § 3).
- **La diversité par case vaut plus que la largeur** : 12 états au plus par case du joueur, 500 en tout, a fait 241e → 22e, et rien dans le
  faisceau n'a payé ensuite (profondeur contre largeur à budget égal, plafond par case de 6 à 30, quota ou halving de la racine : 45 %,
  36 %). C'est dans la lib depuis le 29/10 (`createBeam`, `group` / `perGroup`, `algorithmes.md` § 1), prouvé par ce projet.
- **Une seule famille racine occupe le faisceau vers la profondeur 8 à 12** (le plafond par case retient des cases, pas des coups racine),
  et la décision se prend sur la dernière couche complète. Dans les cas lus, ce n'est pas le faisceau qui tranchait mal mais la note ou le
  modèle de sécurité. Un projet qui voit son faisceau « hésiter » doit d'abord regarder la note.
- **L'adversaire en hypothèse pessimiste graduée** (il pose maintenant ; il pose ; ignoré) plutôt que modélisé : la prédiction de ses coups
  par notre propre faisceau (78 % devinés) a rendu le bot plus sûr sans une caisse de plus (54 % / 48 %). Les joueurs de 2016 avaient la même
  conclusion (fausses bombes, anti-piège). Le défaut connu : quand l'hypothèse pessimiste ne laisse aucun coup, retomber à « ignoré » mène
  dans un cul-de-sac (la danse en miroir) ; une prudence intermédiaire reste à faire.
- **Zéro allocation dans la boucle** : l'état en tableau typé, marquer puis effacer ce qu'on a marqué au lieu de remplir des tableaux entiers
  à chaque pas, l'horloge lue par lots : +18 % le 31/10, les ordres inchangés (la signature). La règle est dans `performance.md` § 6 de
  codingame et dans notre `budget.test.js` (le faisceau, le climb et le pool n'allouent rien).

## 3. Mesurer : ce que ce projet a fixé

- **Le temps se mesure sur la cible, à l'heure chargée.** Un budget de 98 ms sur 100 tenait l'après-midi (0 timeout en 50 parties) et perdait
  le soir (21 timeouts dans 48 défaites : 22e → 264e). Les logs du site ont montré des pauses du serveur de 16 à 150 ms en plein calcul, 1 %
  des tours le soir, 0,2 % la nuit, sans signe avant-coureur : un budget qui réagirait en cours de partie n'aurait rien sauvé. La réponse est
  un budget par l'heure du serveur (85 ms, 60 de 16 h à 1 h UTC) : 1,5 % de timeouts sur les 131 parties classées de la v010. Même leçon que
  fall (`post-mortem-fall-2026.md` § 3), vue d'un autre côté : là, la vitesse ; ici, les pauses.
- **L'auto-jeu ne mesure que contre notre lignée.** L'attaque (trois fois plus d'éliminations contre le Lua, 38 défaites sur 60 contre
  nous-mêmes), la prédiction, la pénalité du trou devant nos bombes : chaque fois l'arène disait une chose et le site une autre. Le juge est
  **un panel du haut de la ligue, sur les mêmes seeds pour les deux versions** (53 contre 32 % ; 61 contre 47 %), apparié seed par seed. Et à
  1 contre 3, les trois adversaires sont des clones : 77 % des parties ont deux adversaires à égalité parfaite ; un gain y vient pour une part
  inconnue des copies.
- **Deux séries avant de croire, et par format.** Un réglage à 61,9 % est retombé à 50,6 % sur des seeds neuves ; un autre gagnait à 2 joueurs
  (42 % pour l'autre valeur) et perdait à 4 (rang 2,42) : d'où une valeur par nombre de joueurs (`_2P`, `_4P`). Le protocole de fall (crible 500,
  confirmation 1 000 sur d'autres graines) vient de là.
- **Les sièges prouvés symétriques, puis une partie par seed** : 18 000 duels à 50,7 / 50,5 % selon le siège, 15 600 parties à 4 à 2,44-2,46 de
  rang moyen par siège ; tourner les sièges sur une même seed n'apportait rien, l'arène joue une partie par seed (quatre fois plus de cartes
  pour le même travail) et imprime le rang par siège à chaque résumé, la vérification continue. À 4 joueurs, **le rang moyen** (2,5 = égal)
  est la mesure, pas les premières places (la moitié sont partagées).
- **Rejouer une partie classée à l'identique** : la carte dans la première frame du replay public, chaque keyframe comparée à notre moteur,
  notre recherche tracée sur le tour en cause ; à profondeur fixe elle reproduit l'ordre et le nombre d'états du site (41 tours / 41). L'oracle
  d'un bot déterministe est le site lui-même ; c'est l'équivalent, pour un faisceau, du harnais de fall qui rejoue le top avec ses ordres.
- **Régler des facteurs à l'œil sur une page à curseurs, puis mesurer** (la méthode de Sami pour la v10) : les rampes dessinées, un repère
  de l'état courant, la ligne `--env-a` qui les reproduit ; la mesure a gardé une rampe sur sept (la fin de partie à 30) et jeté le reste à
  ±1 cran. Dessiner a permis de choisir quoi mesurer ; mesurer a dit ce qui valait.

## 4. Ce qui pourrait entrer dans la lib

- **Rien de nouveau à coder** : les faisceaux locaux et la profondeur à l'échéance y sont. Ce que ce post-mortem ajoute, c'est la preuve
  chiffrée (241e → 22e ; 36 % quand on remet une profondeur fixe) pour qui hésite à les prendre.
- **Une prudence intermédiaire** pour l'adversaire en hypothèse (« il pose au tour d'après » entre « maintenant » et « jamais ») est un réglage
  du problème, pas de la lib : à faire dans le projet si la danse en miroir se mesure.
- **`measure`** : le protocole crible puis confirmation sur d'autres graines (fall § 6) et la mesure par paires sur les mêmes seeds contre un
  panel restent une pratique à documenter, pas du code. Le rang moyen à N joueurs (2,5 = égal) manque peut-être dans `measure.js` pour les
  projets à plus de deux sièges ; à décider si un second projet en a besoin.

## Références

`mcts-codingame/hypersonic/README.md` (versions et mesures, l.54-802 ; pistes, l.863), `hypersonic/docs/post-mortem.md`, `docs/performance.md`
§ 1, 1 ter, 4, 4 bis et 6, `docs/strategies.md` § Hypersonic, `docs/rex-strategies.md` § 3 ; le fil de 2016
https://forum.codingame.com/t/hypersonic-feedback-strategy/2067 ; l'article ICAART 2022 (arXiv 2203.09608) ; [`post-mortem-fall-2026.md`](post-mortem-fall-2026.md).

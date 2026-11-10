# Post-mortem du Fall Challenge 2026 (codingame, 10/11/2026)

Ce que le challenge sur lequel on a passé le plus de temps à chercher des optimisations laisse à la lib et aux projets qui prennent `climb`
(raquette, economie, mad-pod-racing, fantastic-bits) ou `grid` (cuisine, entrepôt, urgences ; feux à venir). Tous les chiffres viennent des
docs de `mcts-codingame/fall-challenge-2026/` (références en fin) ; les crochets sont des intervalles à 95 %. Le post du forum, en anglais :
`fall-challenge-2026/docs/post-mortem-forum.md`.

## 1. Le résumé chiffré

- **Le jeu** : TryAngle Catch, un duel sur un graphe de 20 à 50 maisons reliées par des chemins ; on tient une maison avec plus d'unités que
  l'autre, un triangle avec ses trois coins ; chaque triangle tenu rapporte un point par tour et peut servir (une naissance, une attaque).
  200 tours, 50 ms par tour, 1 s au premier, sur le Node 20 de CodinGame, un cœur.
- **Le bot** : une escalade à un pli sur un plan de nombres (un pas par unité, un coin par naissance), chaque plan joué contre 7 réponses
  adverses (sa règle + 6 tirées d'un réseau de ses pas), la note = moyenne ; une coupe (un enfant plus d'une unité sous le plan gardé
  contre la première réponse n'est pas joué contre les six autres) ; une note à la main + un réseau 16-16-1 d'imitation du top, pesé 3.
- **Le résultat** : 144e / 1 047, Légende (170), 13,70. 62 soumissions en 9 jours (2 au 9/11), dont ~21 remesures du même bot ; une 63e
  sur le jeu permanent le 10/11.
- **Les outils** : un port JS de l'arbitre (parité 100/100 avec le Java, 34 931 tours de simulation identiques), une arène locale qui joue
  au budget du site, un oracle des signatures (chaque version figée rejoue ses coups avec ses options), un harnais qui rejoue les parties
  du top en connaissant les vrais ordres de l'autre, une boucle de mesure (crible 500, confirmation 1 000) dans la file.

## 2. Pourquoi on ne simule pas plusieurs tours (le point 1 de Sami)

Les tailles, aux tours qui décident (7 à 14) :

| Quoi | Combien | Source |
|---|---|---|
| Maisons / triangles d'une carte | 20-50 / 20-50 (petites ≤ 22 triangles, moyennes 23-32, grandes ≥ 33) | README:20, engine/map.js |
| Unités par camp | 13-14 au tour 6, 13-28 au tour 12 (top 28), 43 au tour 25 chez le top, 40+ au tour 30 | README:92, 108, 126 ; analyse-legende:39 |
| Choix d'une unité | rester ou un voisin : degré + 1 ; au plus 12 gènes par maison | src/genes.js |
| Choix d'un triangle tenu | 3 coins pour une naissance ; les attaques restent celles de la règle | src/steps.js:184-190 |
| Gènes d'un plan, tours 7-9 / 10-12 | 1 pli : 17 / 22 ; 2 plis : 36 / 48 ; 3 plis : 57 / 74 ; 4 plis : 80 / 103 | analyse-fable-profondeur:81-90 |
| Ce que coûte un plan | 7 tours simulés + 7 notes (1 si la coupe l'écarte) : 41-55 µs en local, 25 avec la coupe ; 0,09-0,11 ms sur le site | README:190 ; analyse-site-local:12 |
| Plans par tour sur le site | 389 (v054, grandes cartes) → 884-916 (v057-v058) ; 1 443-1 781 sur les petites | README:186-192 |
| À deux plis, petites cartes, sur le site | 351 plans contre 1 673 à un pli | analyse-legende:64 |
| Budget | 45 ms utilisés sur 50 ; la machine locale est 2,2 fois plus rapide | README:150 ; analyse-site-local |

Ce qu'un pli de plus coûte : un tour simulé de plus par réponse et par plan, deux fois plus de gènes à faire bouger, et un plan de départ
(la règle de l'autre figée vers ses destinations) de moins en moins vrai. Mesuré en arène au budget du site : deux plis en direct après
l'ouverture 46-50 % contre un pli, trois plis 43 / 42 / 33 % sur les petites cartes jusqu'au tour 8 / 14 / toute la partie, 7 % partout.

**La cause n'est pas l'adversaire imprévisible, c'est la note.** Le harnais qui rejoue les parties du top en connaissant ses vrais ordres
dit que la profondeur perd quand même (−0,7 à −0,8 capture à deux tours) : la note de fin de plan fait payer le présent pour un futur que
l'autre ne laissera pas arriver. À calcul égal, les réponses tirées rapportent 0,4-0,5 capture, un second pli 0,1-0,2
(`analyse-fable-profondeur.md`). Un seul réglage de profondeur a tenu : deux plis sur les petites cartes pendant l'ouverture, quand il n'y
a pas de contact (v048, 93e de Gold), et il a perdu dès qu'on a su mesurer au budget du site.

**Pour un projet à `climb`** : à partir d'une vingtaine de gènes, un pli noté sur K scénarios bat deux plis notés sur un ; et si la
profondeur ne paie pas, chercher d'abord dans la note (ce qu'elle fait payer au présent), pas dans l'horizon.

## 3. Mesurer à la vitesse de la cible (le point 2)

Seul codingame a un serveur distant avec un budget fixe et net (50 ms) ; pour les autres projets, 50 ms n'a pas de sens. Mais l'écart de
vitesse entre la machine de mesure et la cible a trompé pendant cinq jours : la machine est 2,2 fois plus rapide, l'arène à 45 ms donnait
~700 plans par tour aux deux bots et faisait gagner les idées gourmandes (deux plis 51-53 % en local) qui perdaient sur le site. Depuis le
7/11 l'arène joue les deux bots au budget du site (20 ms par tour, ce que le site donne sur les grandes cartes) : elle s'en approche sans le
reproduire (la v061 à 54 % [51 ; 57] à 20 ms a fait 48 % en ligne, et l'arène surestime la note en général). Deux autres biais du même
genre : le self-play entre bots de même règle (une prédiction de l'adversaire à 94 % en local, 3 sur 16 sur le site, le 3/11), et les
mesures du site lui-même (±1 point et ±9 points de taux sur 100 parties en Gold, ±1,5 en Légende, une nuit de panne).

**À garder en tête** pour tout projet qui déploiera ailleurs que sur cette machine : mesurer au budget de la cible, et juger un gain de
vitesse par ce qu'il rend là-bas (plans par tour lus dans les logs du site), pas ici. Ce n'est pas une règle pour les autres aujourd'hui.

## 4. Plusieurs sources de vérité, assemblées et vérifiées (le point 3)

Chaque source seule a plafonné :

| Seule | Résultat |
|---|---|
| La règle à la main | le plateau de Silver (v001-v012) |
| Le réseau appris, à la place de la note | **1 %** : la recherche trouve exactement les positions où il se trompe (5/11) |
| L'imitation du top seule (TD sur ses 10 006 parties) | **31 %** contre notre bot : « hors distribution », il n'a jamais vu nos milliers de plans candidats |
| L'auto-jeu seul (TD(λ), six cycles) | 31 → 51 % : la parité, pas mieux |
| Les coins de naissance appris (69 % d'accord avec le top) | perdu : son temps a coûté plus qu'il n'a rendu |

Ce qui a marché est l'assemblage, chaque pièce tenue par une autre :

- la note à la main **plus** le réseau d'imitation du top, pesé 3, **plus** quatre tours de DAgger sur nos propres positions (v038, le
  meilleur score de Gold à l'époque) ; la note à la main comme ancre de toute valeur apprise ensuite (`FALL_VALUE_MIX`) ;
- l'adversaire : sa règle (la nôtre jouée de son siège) **plus** six tirages d'un réseau de ses pas appris sur 4 194 parties du top 30 et
  de nos adversaires **plus**, depuis la v063, sa meilleure réponse cherchée contre notre plan (52,6 % [50,1 ; 55,1] sur 1 500) ;
- les vérificateurs, qui disent ce qu'une idée vaut avant de la jouer : le harnais des ordres réels (la même recherche connaissant ses
  vrais ordres capture autant que le top : l'écart est d'information), l'arène au budget du site, l'oracle des signatures, et le site
  lui-même en dernier (avec son bruit).

La leçon : ni l'auto-jeu seul, ni le réglage à la main seul, ni la copie d'un groupe de joueurs seule ; chaque source corrige les
positions que l'autre n'a pas vues, et un vérificateur indépendant tranche avant la mesure chère.

## 5. Les signatures par version (le point 4)

`fall-challenge-2026/oracle/signature.js` + `tests/fixtures/signatures.json` : pour chaque version soumise depuis la v031, ses options
d'environnement et l'empreinte des ordres qu'elle joue sur des positions fixées. Un changement de code (ou d'un défaut, comme
`FALL_BEST_REPLY` passé à 1 pour la v063) doit laisser toutes les anciennes « identique », en leur donnant leurs options d'avant. Ça a tenu
63 versions sans jamais casser une version soumise. Les autres projets ont leurs empreintes ; la différence est « par version, avec ses
options », ce qui permet de garder le code vivant tout en pouvant resoumettre n'importe quelle version à l'identique.

## 6. Ce qui pourrait entrer dans la lib

- **`climb` : noter un plan sur K scénarios, avec une coupe et un scénario ajouté en cours de route.** Aujourd'hui `consider()` appelle
  `score(candidate)` une fois (`src/climb.js`) ; fall a tout fait dans son `score` : K = 7 réponses adverses, la moyenne ; la coupe (un
  candidat plus d'une marge sous le meilleur contre le premier scénario n'est pas joué sur les K−1 autres : +72 % de plans, 59 % [55 ; 64]
  contre le même bot sans) ; et un 8e scénario, le pire trouvé par une escalade de l'autre siège contre le plan courant, ajouté à mi-tour
  (52,6 % sur 1 500). Ça recoupe la question d'economie du 6/11 (« noter un plan de `createClimb` sur K futurs communs », `projets.md`).
  Proposition : une option, pas une obligation ; la règle de `recherche.md` § 4 s'applique (un projet le prouve, la lib reprend) : fall
  l'a prouvé, economie serait le second.
- **`measure` : rien à coder, une pratique à écrire.** Le protocole de fall : crible de 500 parties (retenu au-dessus de 52 % avec la borne
  basse au-dessus de 48 %), puis confirmation de 1 000 sur d'autres graines (> 52 %, borne basse > 50 %) ; le crible rejette, la
  confirmation promeut (le CLAUDE.md de commun le dit déjà en une ligne).
- **La file (le point 5, un défaut à vérifier par commun).** Le 10/11, deux jobs de 9 fils (`arena-fall-challenge-2026-2026-11-10-16-40-*`,
  priorité 1) ont attendu de 16 h 40 à 17 h 55 : chaque fois qu'un fil se libérait, un job `economie` d'un fil ajouté après eux passait
  devant. `docs/backlog.md` (l.448-449) promet le contraire depuis le 31/10 (« une suite de petits jobs ne peut plus le tenir dehors »).
  Pistes : des estimations trop courtes des jobs d'un fil (le remplissage ne prend que ce qui « laisse son départ » au suivant), ou des
  `gap-filled` derrière un `--slot`. Contournement utilisé : 4 jobs de 3 fils à la place de 2 de 9. À lire dans le journal de la file
  (`gap-filled`, `asked`) ce soir-là.

## Références (dans `mcts-codingame/fall-challenge-2026/`)

`README.md` (la chronologie des 63 versions, chaque mesure), `docs/pistes-legende.md` (§ 2-6 quater : les réglages, la profondeur, les
pistes d'après contest), `docs/analyse-fable-profondeur.md` (pourquoi la profondeur perd), `docs/analyse-legende.md` (ce que la Légende
a mesuré), `docs/analyse-site-local.md` (le site contre la machine), `docs/post-mortems.md` (ce que les autres ont dit),
`docs/strategie-higgsboson.md` (le 3e), `docs/post-mortem-forum.md` (notre post).

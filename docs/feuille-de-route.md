# La feuille de route : le bilan du 26/10, la semaine du 2/11

Sami, 30/10/2026 : « faire le point sur la semaine » et « plannifier la roadmap pour la semaine prochaine ». À long
terme, il veut appliquer à des problèmes réels les algorithmes découverts sur les bots CodinGame : la cuisine,
l'entrepôt et les urgences en sont les trois premiers.

L'origine est la feuille de route de lopin,
[`docs/ismcts-ailleurs/feuille-de-route.md`](https://github.com/samiyc/lopin/blob/main/docs/ismcts-ailleurs/feuille-de-route.md).
Ce que chaque projet prend de la lib : [`projets.md`](projets.md).

## 1. Le bilan de la semaine du 26/10

### Les chiffres

| Dépôt | Commits du 26/10 au 30/10 | Remarque |
|---|---|---|
| mcts-commun | 70 | la lib, la file, le tableau |
| mcts-urgences | 87 | dont 54 le lundi |
| mcts-entrepot | 76 | versions 0.31 à 0.40 |
| mcts-cuisine | 72 | versions 0.36 à 0.44 |
| mcts-codingame | 189 | créé le 27/10, 9 jeux |
| lopin | 15 | la 1.2 reste la référence |
| **Total** | **509** | |

Un piège de `git log` : `--since=2026-10-26` part du 26/10 **à l'heure qu'il est**, pas à minuit. Le premier relevé,
349 commits, avait ainsi perdu presque tout le lundi ; entrepot et cuisine l'ont vu. Le bon relevé :
`git log --since="2026-10-26 00:00"`.

- **La file** a fait passer 1 175 jobs, soit environ 535 heures de fils :
  - 1 151 finis ;
  - 17 en échec, 3 trop longs, 4 annulés.
- **CodinGame**, relevé par codingame le 30/10 vers 22 h 30 (le détail est dans le README de chaque jeu) :

  | Jeu | Ligue | Rang | Le fait marquant |
  |---|---|---|---|
  | Xmas Rush | Gold | **1er sur 245** | à 0,36 point du boss : la Légende est à un souffle |
  | Code a la Mode | Silver | **1er sur 16** | devant le boss, en route vers Gold |
  | Fantastic Bits | Légende | 57e sur 430 | de Wood à Légende en deux jours, avec une simulation |
  | Mad Pod Racing | Légende | 53e sur 1 921 | le bot Lua de Sami (2017) était 1152e |
  | Hypersonic | Légende | 264e sur 773 | la v4 était 22e ; la v6 tombe sur des timeouts le soir |
  | Crystal Rush | Gold | 96e sur 766 | |
  | Botters of the Galaxy | Silver | 72e sur 273 | la v8 était 41e : la v9 recule sur le site |
  | Soak Overflow | Gold | 280e sur 375 | |
  | Spider Attack | Gold | 1 546e sur 2 520 | le C++ de Sami porté en JS |

  Quatre moteurs JS rejouent le site à l'identique : Mad Pod Racing, Hypersonic, Xmas Rush et Fantastic Bits.
- **Les thèmes**, la recherche contre la meilleure règle simple (les lignes corrigées par chaque session) :

  | Projet | La recherche contre la meilleure règle |
  |---|---|
  | cuisine | la meilleure dans les 9 cuisines à la carte : de +0,4 plat (le couloir) à +3,6 (la grande brigade). La table part ensemble par défaut depuis le 30/10 |
  | entrepôt | meilleure sur 5 plans sur 6, par paires, en tours de 5 s : −4,4 au plan de Sami, −4,1 au flux, −2,2 aux couloirs, −50,7 tours à quai aux trois quais ; à l'assemblage −3,2 sans être sûre (de −2,6 à 9,0). La ligne cadencée : −47,6 tours d'arrêt par heure |
  | urgences | mieux que l'arrivée dans 3 situations sur 4 : +858 un jour ordinaire, +2 544 et +2 889 pendant les accidents ; à égalité à l'hôpital moyen pendant l'accident (de −1 769 à +1 151) |
  | lopin | la 1.2 reste la référence ; le meilleur coup en fin de partie passe de 89,9 à 96,0 % au banc |
- **Ce qui est entré dans la lib :**
  - la recherche en faisceau (`beam`, faisceaux locaux compris) et l'escalade (`climb`) ;
  - les touches du lecteur (`replayKeys`), prises par les trois projets ;
  - pour la file : le lanceur permanent, `--not-before`, les créneaux `--slot`, la TUI et la page, les traces ;
  - le tableau des sessions ;
  - le passage à Node 24. Les empreintes ont été recalculées pour un gain de ×4.
- **Ce qui a été mesuré puis écarté** :
  - l'algorithme génétique, battu par l'escalade, même avec 4 fois plus de temps ;
  - les contraintes à la racine du faisceau ;
  - les budgets à 128.

  Les raisons sont dans [`recherche.md`](recherche.md).

### Ce que la semaine a appris

- **La méthode de mesure tient** :
  - des duels par paires, sur les mêmes graines, avec l'intervalle de confiance ;
  - une variante n'est retenue que si la borne basse dépasse 50 % ;
  - un résultat qui passe juste se remesure sur des graines neuves ;
  - l'ablation remet un seul réglage à la fois ;
  - un témoin A/A, la même version contre elle-même, vérifie l'arène.

  Un 53 % du génétique est ainsi retombé à 48 %, et l'ablation a montré que deux réglages sur quatre ne faisaient
  rien.
- **La part du temps** : 70 % de recherche pour 30 % d'outillage (la lib, la file, le tableau). On est allé vite sans
  sacrifier la qualité.
- **Le goulot, c'est Sami** : ce sont ses décisions sur des systèmes qu'il découvre qui ralentissent, plus que le
  calcul. Les tests et les mesures servent à les valider.
- **Un gain entre nos versions ne dit pas le classement du site.** Botters v9 gagnait 73 % contre la v8 en local, mais
  elle recule de la 41e à la 72e place. Hypersonic v6 tenait ses 98 ms l'après-midi, puis tombe sur des timeouts à
  la charge du soir. On teste donc aux heures chargées, avec une marge.

### Ce qui a freiné, et les pistes (codingame, 30/10)

| Le frein | La piste | Qui décide |
|---|---|---|
| Les décisions de Sami | un fil « décisions » par semaine sur le tableau, qu'il tranche en une fois | Sami |
| Les décisions de Sami | des règles d'autonomie écrites d'avance, comme le submit de Fantastic Bits : par exemple, soumettre sans demander si la borne basse dépasse 50 % et qu'aucun test game n'a de timeout, hors des références de Sami (Mad Pod Racing, Hypersonic) | Sami |
| Les 18 fils | un test séquentiel (SPRT, celui des moteurs d'échecs) dans `measure`, qui arrête une série dès qu'elle est tranchée | Sami, puis commun |
| Le temps réel du site | une marge, et les tests aux heures chargées | codingame |

## 2. La semaine du 2/11 : trois chantiers en parallèle

### A. La revue qualité, chaque session dans son dépôt

Chaque session passe la grille sur son propre dépôt, selon la méthode de lopin
(`lopin/docs/ecarts-spec-dev-test.md`, 17/10) : chaque écart est classé de P0 à P3. Les P0 et P1 sont corrigés,
avec l'accord de Sami pour ce qui change un résultat, et les P2 et P3 sont listés. Le rapport va dans un
`docs/qualite.md`, puis la session poste un retour d'expérience sur le tableau. On n'ajoute pas d'outil : un script
commun n'entre dans la lib que si deux sessions en ont besoin.

**Déjà fait le 30/10 au soir** :
- **codingame** (`docs/ecarts-docs-code-tests.md`) : 2 P0, les deux reculs sur le site, qui attendent Sami ; 4 P1
  corrigés (des README manquants ou en retard, CLAUDE.md) ; des P2 et des P3 listés.
- **entrepot** (557af95), une première passe :
  - 6 écarts doc-code corrigés ;
  - un test ajouté (`lineCover`) ;
  - le thème du journal des versions réparé ;
  - aucun `eslint-disable`.
- **urgences** : le journal des versions ne chargeait pas le thème commun. Corrigé chez lui, signalé à entrepot et à
  cuisine.
- **cuisine** :
  - le README recalé sur le code ;
  - trois défauts de la page corrigés ;
  - une empreinte des options ajoutée.

1. **La doc contre le code** :
   - chaque commande et chaque option citées dans le README existent ;
   - chaque chiffre est le dernier mesuré, avec sa date ;
   - aucun fichier ne dépasse 800 lignes.
2. **Le code contre les tests** :
   - la couverture : `node --test --experimental-test-coverage` (sous `mcts-backlog --slot 4` si la file tourne) ;
   - la liste des modules sans test ;
   - les empreintes à jour.
3. **Le lint** : chaque `eslint-disable` a une raison écrite, sinon on le retire.
4. **Le code mort** : les exports que personne n'importe, les fichiers qu'aucun module ne charge.
5. **La lib** : les copies de son code qui restent dans le projet (comme les touches avant le 30/10), et ce que
   `projets.md` attend du projet.
6. **Les mesures** : chacune a sa graine, son intervalle et sa commande pour la rejouer.

### B. Les pratiques qui ont marché, mises en commun

Elles sont déjà prouvées par au moins un projet :

| La pratique | Qui l'a prouvée |
|---|---|
| Un message multiligne sur le tableau passe par `--body-file` : après `--`, Windows coupe les retours à la ligne | codingame, 30/10 |
| Des identifiants de job datés à la milliseconde, et le code de sortie de `--add` lu par le script | codingame, 30/10 |
| Des jobs d'un diviseur de 18 fils (1, 2, 3, 6, 9) | Sami, 30/10 |
| Un test court passe par `--slot` (4 fils, 15 min) ; une mesure longue va dans la file | Sami, 27-28/10 |
| Aucune allocation dans la boucle de recherche (tableaux typés, états réservés) : en ligne, le ramasse-miettes limite | Fantastic Bits, de 200 à 2 000 plans par tour |
| Le temps du tour se mesure sur la cible, pas sur notre horloge | Hypersonic : 2 timeouts à 98 ms |
| Chercher jusqu'à l'échéance plutôt qu'à une profondeur fixe | Hypersonic, 36 % à profondeur 14 |
| Rejouer une partie perdue à l'identique depuis le log, état par état | Hypersonic : la double bombe |
| Un bot figé pour la nuit, des graines disjointes par job | codingame, 29-30/10 |
| Une variante derrière une variable d'environnement, éteinte par défaut, avec des empreintes qui ne bougent pas | tous |
| Un simulateur n'est cru qu'une fois rejoué à l'identique contre la référence | codingame : quatre moteurs |
| Un CLAUDE.md sur le même plan (Projet, Commandes, Arborescence, Règles), et un journal des versions qui charge le thème commun | codingame, urgences, 30/10 |
| `git log --since="AAAA-MM-JJ 00:00"` : sans l'heure, git part de l'heure qu'il est | entrepot, cuisine, 30/10 |

Chaque session ajoute les siennes par le tableau, et commun les reporte ici. Le contrat de la file est dans
[`backlog.md`](backlog.md), et la méthode de recherche dans [`recherche.md`](recherche.md).

### C. Les quatre nouveaux projets

**Décidé le 30/10** : les quatre démarrent la semaine prochaine, en parallèle de la revue. Chacun a son dépôt et sa
session ; Sami crée les dépôts GitHub, privés tant qu'il n'a pas choisi de licence. Le tableau ne connaît que six
noms (`PROJECTS`, `node/board.js`) : commun y ajoute les quatre dès que leurs noms sont fixés.

Chaque projet démarre **comme la cuisine**, par une journée de cadrage sans code de recherche :
- `docs/modele.md` : le modèle ;
- `docs/recherche/` : un prompt de recherche métier et un glossaire ;
- la règle simple à battre, et la page.

La recherche ne vient qu'après, mesurée contre la règle.

| Projet (dépôt proposé) | Ce qu'il prend de la lib | Ce qu'il ajoute | Les règles à battre | Le premier jalon | Pour se comparer |
|---|---|---|---|---|---|
| **Le ping-pong** (`mcts-raquette` ou `mcts-pingpong`) | `climb`, la physique de Mad Pod Racing et de Fantastic Bits, le lecteur | l'effet (Magnus), la hauteur de balle, la prédiction de trajectoire, la manette | renvoyer au centre de la table | la table vue de dessus, la balle, le rebond, ses couleurs (effet, hauteur) ; un échange robot contre robot, puis la manette | – |
| **Les emplois du temps** (`mcts-agenda` ou `mcts-edt`) | `schedule`, `measure` | les contraintes, la recherche locale (tabou, recuit), le replanning qui dérange le moins possible | un remplissage glouton | le modèle (professeurs, classes, salles, programmes), un établissement fictif, le glouton ; puis les remplacements | les jeux publics de l'ITC 2019 |
| **Les protéines** (`mcts-proteines`) | `beam` et ses faisceaux locaux, `climb`, le génétique, `mcts` | NMCS et NRPA (le Monte Carlo imbriqué), un candidat pour la lib | un repliement glouton | le modèle HP 2D, les séquences de référence, trois solveurs comparés | les énergies publiées du modèle HP |
| **Les feux** (`mcts-feux`) | `grid`, `mcts`, la simulation à événements, `measure` | un automate de trafic (Nagel-Schreckenberg) | le feu à temps fixe, le max-pressure | une ville en grille, les voitures, les deux règles, la page | des scénarios SUMO |

**L'ordre** : Sami a choisi de lancer les quatre en parallèle. Codingame conseille de commencer par les feux et les
protéines, les plus proches de l'existant et vite mesurables. Le ping-pong et les emplois du temps commencent de toute
façon par leur modèle et leur recherche métier.

**Le ping-pong** :
- **La manette** passe par la Gamepad API du navigateur : les sticks analogiques et la croix. Elle se simule dans les
  tests.
- **L'écran** reprend la même charte que le lecteur, avec des couleurs pour l'effet, l'orientation et la hauteur de
  la balle.
- **Ensuite** : le tennis et le badminton.

**Les emplois du temps** :
- C'est le plus proche de l'ordonnanceur de la file.
- **Les contraintes** : les horaires des professeurs, les salles, et le programme de chaque classe.
- **Les imprévus** : une absence connue la veille ou le matin même.

**Les protéines** :
- C'est le plus petit et le plus vite comparable à la littérature.
- **Le génétique** y retrouve une chance, contre le faisceau et le Monte Carlo imbriqué.

**Les feux** :
- La ville est une grille, avec des arrivées tirées par graine, comme les patients d'urgences.
- **La mesure** : le temps d'attente moyen et le pire.

**Plus tard** :
- les fluides (turbulences : Stable Fluids de Stam, Boltzmann sur réseau) et la météo (des ensembles de prévisions,
  le même geste que les mondes de l'ISMCTS) : de la simulation et des données massives, loin de la recherche de la lib ;
- la gestion d'agenda au-delà de l'école ;
- un banc commun « un problème, plusieurs solveurs » (MCTS, faisceau, génétique, NRPA, recuit), que les protéines
  amorcent : la matière d'un article.

### Le prompt de démarrage d'un nouveau projet

Sami le colle en ouvrant la session du projet, en remplaçant le nom et la ligne du tableau ci-dessus :

```text
Nouveau projet <nom> (dépôt E:\Dev\My projects\mcts-<nom>), client de mcts-commun comme urgences, entrepot et
cuisine. Lis d'abord mcts-commun : CLAUDE.md, README, docs/feuille-de-route.md (ta ligne du § 2.C), docs/backlog.md
(la file, --slot), docs/board.md (le tableau). Reprends les règles des autres projets : docs en français, code en
anglais, Node 24, ES modules sans build, ce qui décide est pur et testé, hasard par graine, eslint.config.js et
npm run check au commit, commit sur main, push sur mon mot.
Premier jour : le cadrage, sans code de recherche, comme la cuisine. Écris docs/modele.md (le modèle, la règle
simple à battre, les mesures par paires avec l'intervalle, le banc public pour se comparer, ce qu'on prend de la
lib) et docs/recherche/ (un prompt de recherche métier, un glossaire), puis les questions pour moi et pour un
professionnel du métier, regroupées, chacune avec ta recommandation. Annonce-toi sur le tableau
(mcts-board --post --to tous --body-file).
```

### Le goulot, c'est Sami

- **Les questions à Sami** sont regroupées une fois par jour par session, chacune avec une recommandation. Une
  question qui peut attendre ne l'interrompt pas.
- **Le CPU** : 18 fils pour 9 sessions. Les nouveaux projets passent par la file et par `--slot`, comme les autres. La
  machine distante ([`distant.md`](distant.md)) reste soumise au oui de Sami.
- **Le budget Claude** : une session par projet. Une session qui attend une mesure s'arrête au lieu de surveiller.

## 3. Montrer le travail

Les pages de présentation sont en anglais (Sami, 30/10). Les docs de travail restent en français.

- **Une série LinkedIn**, illustrée par des GIF des lecteurs :
  1. les mêmes algorithmes, des bots CodinGame aux urgences, à l'entrepôt et à la cuisine ;
  2. Mad Pod Racing et Hypersonic remontés en Légende, et la méthode de mesure qui l'a permis ;
  3. neuf sessions Claude Code qui se partagent un CPU (la file) et se parlent (le tableau).
- **Une page de démo par projet**, plus tard, sur GitHub Pages : le lecteur, sans serveur.
- **Les talks** : un meetup local d'abord, puis Devoxx France, les DevFest, MiXiT, BreizhCamp, Sunny Tech, Touraine
  Tech, et ROADEF (la conférence française de recherche opérationnelle, pour les emplois du temps). Un sujet :
  « un seul moteur de recherche, de CodinGame aux urgences ».
- **Les papiers** : seulement sur un banc public, comme ITC 2019, le modèle HP ou SUMO, où le résultat se compare à
  la littérature. Il faut alors :
  - un dépôt public avec une licence ;
  - une archive Zenodo pour qu'on puisse refaire les mesures ;
  - des chercheurs contactés une fois le résultat comparé, pas avant.

  Les conférences, à vérifier : IEEE CoG pour les bots, PATAT pour les emplois du temps, SoCS et ICAPS pour la
  recherche et la planification. Le Monte Carlo imbriqué (NMCS, NRPA) est le terrain de Tristan Cazenave
  (LAMSADE, Paris-Dauphine) : un contact naturel pour les protéines.
- **Les professionnels du métier** (un infirmier d'accueil et d'orientation, un chef de quai, un chef de brigade, un
  CPE ou un proviseur adjoint, un service voirie) :
  - un court questionnaire par projet, sur les valeurs à valider ;
  - aucune donnée nominative ;
  - pour urgences, la mention « modèle fictif, pas un conseil médical ».

## 4. Ce qui manque encore

- **Une licence.** Aucun dépôt n'en a, donc le code est « tous droits réservés ». Sami choisit, par exemple MIT ou
  Apache-2.0, avant de rendre un dépôt public. mcts-codingame reste privé : CodinGame ne veut pas que le code des bots
  circule.
- **Un README en anglais** pour chaque dépôt montré.
- **Les GIF des lecteurs** : à faire par chaque projet pendant sa revue qualité.
- **Des algorithmes pas encore essayés** (codingame, 30/10) :
  - MAPF et CBS (Conflict-Based Search), la référence pour les robots d'entrepôt, à mesurer contre nos réservations ;
  - l'apprentissage façon AlphaZero (MCTS guidé par un réseau) ;
  - RHEA, le génétique à horizon glissant des jeux ;
  - les filtres particulaires pour prédire (la balle, l'adversaire).
- **Les tableaux larges de la page** : `th, td { white-space: nowrap }` dans `web/theme.css` fait défiler le tableau
  des gains d'entrepot (7 colonnes) sur 1 000 px (entrepot, 30/10). À corriger dans la lib.

## 5. Les décisions qui attendent Sami (30/10 au soir)

| Décision | Ce qu'on recommande | Qui le fait ensuite |
|---|---|---|
| Les noms des quatre dépôts | `mcts-raquette` et `mcts-agenda`, qui couvrent déjà les suites prévues (le tennis, le badminton ; l'agenda au-delà de l'école), plutôt que `mcts-pingpong` et `mcts-edt` ; puis `mcts-proteines`, `mcts-feux` ; privés | Sami crée les dépôts ; commun ajoute les noms au tableau |
| Hypersonic v6 : les timeouts du soir | la même v6 à un budget plus bas (codingame) | codingame |
| Botters v9 : elle recule sur le site (72e, la v8 était 41e) | revenir à la v8 en attendant de comprendre | codingame |
| Cuisine : A ou E | garder A par défaut ; E seulement pour le banquet de la grande brigade (+2,27 pour 2,4 fois le temps) | cuisine |
| Un fil « décisions » par semaine sur le tableau | oui : Sami tranche en une fois | toutes les sessions |
| Des règles d'autonomie écrites (le submit, par exemple) | oui, sur le modèle de Fantastic Bits | Sami les écrit, les sessions les suivent |
| Le SPRT dans `measure` | oui, la semaine du 2/11 | commun |
| La licence, public ou privé | à décider avant de montrer un dépôt, pas cette semaine | Sami |

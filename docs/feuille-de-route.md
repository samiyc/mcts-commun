# La feuille de route : le bilan du 26/10, la semaine du 2/11

Sami, 30/10/2026 : « faire le point sur la semaine » et « plannifier la roadmap pour la semaine prochaine ». À long
terme, il veut appliquer à des problèmes réels les algorithmes découverts sur les bots CodinGame : la cuisine,
l'entrepôt et les urgences en sont les trois premiers.

L'origine est la feuille de route de lopin,
[`docs/ismcts-ailleurs/feuille-de-route.md`](https://github.com/samiyc/lopin/blob/main/docs/ismcts-ailleurs/feuille-de-route.md).
Ce que chaque projet prend de la lib : [`projets.md`](projets.md).

## 1. Le bilan de la semaine du 26/10

### Les chiffres

| Dépôt | Commits depuis le 26/10 | Remarque |
|---|---|---|
| mcts-commun | 51 | |
| mcts-urgences | 32 | |
| mcts-entrepot | 36 | |
| mcts-cuisine | 32 | |
| mcts-codingame | 187 | créé le 27/10 |
| lopin | 11 | |
| **Total** | **349** | |

- **La file** a fait passer 1 175 jobs, soit environ 535 heures de fils :
  - 1 151 finis ;
  - 17 en échec, 3 trop longs, 4 annulés.
- **CodinGame** (le détail est dans le README de chaque jeu, chez mcts-codingame) :
  - Mad Pod Racing : en Légende, de la 1152e place (le bot Lua de Sami, 2017) à la **57e sur 1 879** ;
  - Hypersonic : en Légende, de la 424e (le bot Lua, 2016) puis 241e à la **22e sur 769** ;
  - Crystal Rush : 85e sur 762 en Gold ;
  - Code a la Mode : en Silver ;
  - Botters of the Galaxy : 45e sur 268 en Silver.
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

## 2. La semaine du 2/11 : trois chantiers en parallèle

### A. La revue qualité, chaque session dans son dépôt

Chaque session passe la grille sur son propre dépôt. Elle note ce qu'elle trouve dans un `docs/qualite.md`, corrige
ce qui est sûr, puis poste un retour d'expérience sur le tableau. On n'ajoute pas d'outil : un script commun n'entre
dans la lib que si deux sessions en ont besoin.

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

Chaque session ajoute les siennes par le tableau, et commun les reporte ici. Le contrat de la file est dans
[`backlog.md`](backlog.md), et la méthode de recherche dans [`recherche.md`](recherche.md).

### C. Les quatre nouveaux projets

**Décidé le 30/10** : les quatre démarrent la semaine prochaine, en parallèle de la revue. Chacun a son dépôt et sa
session ; Sami crée les dépôts GitHub. Chaque projet commence par **une journée de cadrage sans code de recherche** :
- le modèle ;
- la règle simple à battre ;
- les mesures ;
- les questions pour Sami et pour un professionnel.

La recherche ne vient qu'après.

| Projet (dépôt proposé) | Ce qu'il prend de la lib | La règle à battre | Le premier jalon | Pour se comparer |
|---|---|---|---|---|
| **Raquette**, le ping-pong (`mcts-raquette`) | `climb`, `createRng`, le lecteur et ses touches | renvoyer au centre de la table | la balle (rebond, effet Magnus, hauteur en couleur), vue de dessus en 2D ; un robot contre un robot, puis la manette | – |
| **Agenda**, les emplois du temps (`mcts-agenda`) | l'ordonnanceur (`schedule`), `createRng` | un remplissage glouton | un établissement fictif de 3 classes et 6 professeurs, sans conflit, puis les remplacements | les jeux d'essai publics ITC 2019 |
| **Protéines**, le modèle HP (`mcts-proteines`) | `beam` et ses faisceaux locaux, `climb`, les grilles | un repliement glouton | l'énergie atteinte sur les séquences de référence | les records publiés du modèle HP |
| **Feux**, la circulation (`mcts-feux`) | la simulation à événements (comme urgences), les grilles, MCTS | des cycles fixes | une petite ville en grille, avec le temps d'attente moyen | des scénarios SUMO |

**Raquette** :
- **La manette** passe par la Gamepad API du navigateur : les sticks analogiques et la croix. Elle se simule dans les
  tests.
- **L'écran** reprend la même charte que le lecteur, avec des couleurs pour l'effet, l'orientation et la hauteur de
  la balle.
- **Ensuite** : le tennis et le badminton.

**Agenda** :
- C'est le plus proche de l'ordonnanceur de la file.
- **Les contraintes** : les horaires des professeurs, les salles, et le programme de chaque classe.
- **Les imprévus** : une absence connue la veille ou le matin même.

**Protéines** :
- C'est le plus petit et le plus vite comparable à la littérature.
- **Le génétique** y retrouve une chance, contre le faisceau et le Monte Carlo imbriqué.

**Feux** :
- La ville est une grille, avec des arrivées tirées par graine, comme les patients d'urgences.
- **La mesure** : le temps d'attente moyen et le pire.

**Plus tard** :
- les fluides (turbulences) et la météo : de la simulation et des données massives, loin de la recherche de la lib ;
- la gestion d'agenda au-delà de l'école.

### Le prompt de démarrage d'un nouveau projet

Sami le colle en ouvrant la session du projet, en remplaçant le nom et la ligne du tableau ci-dessus :

```text
Nouveau projet <nom> (dépôt E:\Dev\My projects\mcts-<nom>), client de mcts-commun comme urgences, entrepot et
cuisine. Lis d'abord mcts-commun : CLAUDE.md, README, docs/feuille-de-route.md (ta ligne du § 2.C), docs/backlog.md
(la file, --slot), docs/board.md (le tableau). Reprends les règles des autres projets : docs en français, code en
anglais, Node 24, ES modules sans build, ce qui décide est pur et testé, hasard par graine, eslint.config.js et
npm run check au commit, commit sur main, push sur mon mot.
Premier jour : le cadrage, sans code de recherche. Écris docs/cadrage.md : le modèle, la règle simple à battre, les
mesures (par paires, avec l'intervalle), le banc public pour se comparer, ce qu'on prend de la lib, et les
questions pour moi et pour un professionnel du métier, chacune avec ta recommandation. Annonce-toi sur le tableau
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
- **Les talks** : Devoxx France, MiXiT, ROADEF (la conférence française de recherche opérationnelle, pour l'agenda
  et l'ordonnancement), ainsi que les meetups IA et JavaScript.
- **Les papiers** : seulement sur un banc public, comme ITC 2019, le modèle HP ou SUMO, où le résultat se compare à
  la littérature. Il faut alors :
  - un dépôt public avec une licence ;
  - une archive Zenodo pour qu'on puisse refaire les mesures ;
  - des chercheurs contactés une fois le résultat comparé, pas avant.
- **Les professionnels du métier** (une infirmière, un cariste, un chef, un proviseur) :
  - un court questionnaire par projet, sur les valeurs à valider ;
  - aucune donnée nominative ;
  - pour urgences, la mention « modèle fictif, pas un conseil médical ».

## 4. Ce qui manque encore

- **Une licence.** Aucun dépôt n'en a, donc le code est « tous droits réservés ». Sami choisit, par exemple MIT ou
  Apache-2.0, avant de rendre un dépôt public. mcts-codingame reste privé : CodinGame ne veut pas que le code des bots
  circule.
- **Un README en anglais** pour chaque dépôt montré.
- **Les GIF des lecteurs** : à faire par chaque projet pendant sa revue qualité.

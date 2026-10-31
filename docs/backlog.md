# Se brancher sur la backlog de la machine

Sami (26/10/2026) : d'autres applications doivent pouvoir ajouter des jobs à la backlog et les suivre. Elles passent
par la commande `mcts-backlog`, qui sert aussi aux humains. Elles peuvent l'appeler depuis n'importe quel langage :
`node chemin/vers/mcts-commun/bin/backlog.js …` ou `npx mcts-backlog …` dans un projet lié. Cette page est le
contrat : les commandes, ce qu'elles écrivent sur la sortie, leurs codes de sortie, les fichiers qu'on peut lire.

**On n'écrit jamais `queue.json` à la main**, ni avec un autre programme. Toute modification passe par
`mcts-backlog`, qui la fait en tenant le verrou de la file (`queue.lock`). Sans ce verrou, un ajout fait pendant que
le lanceur écrit pouvait perdre l'un ou l'autre. Le test le montre : sans verrou, 7 à 14 jobs perdus sur 26.

## Le dossier

`~/.mcts-backlog/`, ou `MCTS_BACKLOG_HOME`, ou `--home DOSSIER` sur chaque commande.

| Fichier | Contenu | Lire sans risque ? |
|---|---|---|
| `queue.json` | les jobs à venir et en cours | oui, mais par `--status` ou `--list --json` |
| `done/AAAA-MM.json` | les jobs finis, par mois | oui |
| `runs/<date>_<id>.txt` | la sortie de chaque job | oui, même pendant qu'il tourne |
| `traces/<date>_<id>.jsonl` | la trace de la bibliothèque dans le job | oui |
| `journal/AAAA-MM.jsonl` | ce que fait le lanceur, une ligne JSON par événement | oui |
| `job-log/AAAA-MM.jsonl` | une ligne par job fini : fils, minutes, mémoire | oui |
| `slots.json` | les fils pris sur la machine, par lanceur | oui ; écrit par les lanceurs seuls |

## Un job

```json
{ "id": "cuis-banquet-2026-10-27", "cwd": "E:/Dev/My projects/mcts-cuisine", "command": "npm run compare -- …",
  "estimate": "40 min", "threads": 1, "priority": 2, "after": ["cuis-base-2026-10-27"], "due": "2026-10-27T08:00",
  "limit": 120, "skipIf": "node scripts/deja-mesure.js", "status": "todo" }
```

- **`id`, `cwd`, `command`** sont obligatoires, et l'id doit être neuf (ni dans la file, ni dans l'archive).
- **`estimate`** (« 40 min », « 1 h 30 ») est la durée annoncée. Depuis le 27/10, l'ordre et la frise prennent
  plutôt celle qu'apprend l'archive (`src/estimate.js`) : la médiane des 5 derniers passages de la même commande
  dans le même dossier, sinon l'estimation corrigée du rythme du projet (ses 30 derniers jobs finis, 3 au moins).
  Sur les 292 jobs finis au 27/10, l'écart médian à la durée réelle passe de ×2,9 à ×1,5. `priority` vaut 1
  (urgent), 2 (normal) ou 3 (peut attendre) ; `--set-priority` la change en place.
- **`measured: true`** (`--measured` sur `--add` ou `--add-file`) : l'estimation vient d'une mesure du code
  d'aujourd'hui, la file la garde telle quelle (cuisine, 28/10/2026 : des estimations refaites après les gains de vitesse
  étaient encore multipliées par ×0,12, le rythme de jobs estimés avant eux ; la file disait 108 min pour environ 45).
- **`after`** liste les ids qui doivent être finis avant. `due` est l'heure où le résultat doit être là. `limit` est
  la durée maximale en minutes : au-delà, le job est arrêté et finit `timeout`.
- **`skipIf`** est une commande du projet, lancée dans `cwd` juste avant le job. Si elle sort à 0, le job est
  `skipped`, et la première ligne qu'elle a écrite en donne la raison. Elle reçoit `MCTS_BACKLOG_HOME`. lopin s'en
  sert pour ses duels : une série partie trop bas s'arrête là.
- **Les statuts** : `todo`, `scheduled` (avec `notBefore`), `running`, puis une fin parmi `done`, `failed`,
  `timeout`, `skipped` et `cancelled`. Un job fini part dans `done/`.
- **`notBefore`** (`--not-before 2026-10-30T20:00` sur `--add`, ou dans le fichier de `--add-file`) : le job attend
  cette heure, en `scheduled`. Une heure illisible est refusée à l'ajout. C'est ainsi qu'un long job garde la nuit
  quand un lanceur permanent tourne (§ « Un lanceur permanent »).
- Le job reçoit `MCTS_THREADS` (ses fils), `MCTS_TRACE_FILE` (sa trace), `MCTS_BACKLOG_HOME`, et dans
  `NODE_OPTIONS` un `--import` qui ouvre sa trace avant ses propres modules (`node/trace-preload.js`).
- **La commande** après `--` : un seul mot est la ligne telle quelle pour le shell (`-- "npm run x -- --a 1"`) ;
  plusieurs mots sont mis bout à bout, chacun entre guillemets s'il contient un espace ou un caractère du shell
  (`-- node -e "console.log('a b')"` garde son code).
- **Le shell est celui du système**, pour les jobs comme pour `--slot` : `cmd.exe` sous Windows, pas `sh` (lopin et
  cuisine, 28/10/2026). Un `| grep`, un `&` qui met en arrière-plan ou un `$VAR` n'y font pas ce qu'on attend : un
  `&` y enchaîne les commandes, et des écritures lancées ainsi en parallèle se sont perdues. Une commande qui en a
  besoin devient un script du projet (`node scripts/….mjs`), écrit avec l'outil d'écriture de fichiers plutôt que
  par un heredoc.

## Les commandes

| Commande | Ce qu'elle fait | Sortie | Code |
|---|---|---|---|
| (aucune) | lance la file jusqu'au bout : le lanceur s'arrête quand plus rien n'est prêt | ses lignes | 0 |
| `--stay` | lance la file et reste : la file vide, il la relit toutes les 5 s et prend les jobs qui arrivent, `scheduled` compris à leur heure. Un seul à la fois : un second `--stay` s'en va (§ « Un lanceur permanent ») | ses lignes ; « Un lanceur permanent tourne déjà » | 0 |
| `--add ID --cwd DOSSIER [options] -- COMMANDE` | ajoute un job. Options : `--estimate`, `--measured`, `--threads`, `--min-threads`, `--priority`, `--after A,B`, `--due`, `--not-before`, `--limit`, `--skip-if` | une ligne | 0, ou 1 si refusé (id pris, champ manquant, dossier introuvable, heure illisible) |
| `--add-file PROJET/night.json [--tag T | --no-tag] [--measured]` | ajoute les jobs d'un fichier, chaque id suffixé de `-T` (la date du jour par défaut ; `--no-tag` garde les ids), chacun lancé dans son `cwd` (relatif au fichier, son dossier par défaut) | une ligne par job | 0 ou 1 |
| `--status ID [--json]` | où en est un job : à venir (`plannedStart`, ou `waiting` et `blocked`), en cours, fini (`status`, `reason`, `minutes`) ; `output` et `trace` en chemins absolus ; tiré de sa trace, `incidents` (`errors`, `crashed`, `slow`, `overbooked`) et `reported` (le dernier `progress` : `done`, `of`, `unit`, `endAt`) | une ligne, ou un objet JSON (`null` si l'id est inconnu) | 0, ou 3 si l'id est inconnu |
| `--wait ID [--timeout MIN] [--json]` | attend la fin du job, en relisant la file toutes les 2 s | comme `--status` | 0 fini, 1 échec ou trop long, 2 annulé ou sauté, 3 inconnu, 4 pas fini au bout de `--timeout` |
| `--cancel ID` | un job à venir finit `cancelled` tout de suite, et ceux qui en dépendent sont bloqués ; un job en cours est marqué, et son lanceur l'arrête | une ligne | 0, ou 3 si l'id est inconnu |
| `--retry ID [--priority N]` | remet un job fini dans la file sous `ID-r1` (puis `-r2`…) : même commande, même dossier, même priorité sauf `--priority`, sans ses prérequis ni son échéance | une ligne | 0, ou 1 s'il n'est pas fini |
| `--set-priority MOTIF N` | donne la priorité N (1 à 3) aux jobs à venir dont l'id correspond au motif (`*` : n'importe quels caractères, entre guillemets pour le shell), sans les annuler ni changer leur id ; le lanceur en route la suit dès le job suivant ; `priority-set` au journal | une ligne | 0, 1 si N n'est pas 1, 2 ou 3, 3 si aucun job à venir ne correspond |
| `--slot N [--id NOM] -- COMMANDE` | lance un test ou une mesure **hors file** dans N fils des créneaux de la machine : attend qu'ils soient libres (servi avant les jobs suivants de la file, voir la recommandation 9), lance la commande au premier plan avec `MCTS_THREADS=N`, puis les rend. **4 fils et 15 min au plus** : au-delà de 4, refusé ; à 15 min, arrêté. Le shell est `cmd.exe` sous Windows (§ « Un job ») | la sortie de la commande ; une ligne sur la sortie d'erreur tant qu'il attend | celui de la commande ; 2 refusé (plus de 4 fils) ; 124 arrêté à 15 min |
| `--push MACHINE`, `--pull MACHINE`, `--list --machine MACHINE` | une autre machine : les jobs marqués `--machine MACHINE` (sur `--add` ou `--add-file`) y partent, sa file se lit d'ici, ses résultats reviennent ([`distant.md`](distant.md)) | des lignes, ou la vue JSON de là-bas | 0, ou 1 si la machine est inconnue ou injoignable |
| `--help` | l'aide ; une option inconnue est refusée (code 1) et ne lance jamais de lanceur | du texte | 0 |
| `--list --json` | toute la vue : la machine, les jobs en cours, la nuit à venir, les bloqués, les finis, le journal, les traces | un objet JSON | 0 |

## Un lanceur permanent

Sami (29/10/2026) : le lanceur démarre avec le PC, et la file vide ne l'arrête plus. Il attend les jobs suivants, sans
que personne ait à le relancer.
- **`mcts-backlog --stay`** : la file vide, le lanceur écrit une fois `runner-idle` à son journal, puis relit la
  file toutes les 5 s (`MCTS_BACKLOG_POLL_MS`). C'est la relecture qu'il fait déjà en attendant des fils, et elle ne
  coûte presque rien. Les créneaux `--slot` sont servis comme avant.
- **Un seul à la fois** : il s'inscrit dans `stay.json` (`{ pid, since }`, `node/stay.js`). Un second `--stay` y
  trouve un pid vivant et s'en va, avec le code 0 : le lancer à chaque ouverture de session ne risque rien. Les vues le
  montrent « permanent » même quand son démarrage est sorti des lignes du journal qu'elles lisent.
- **Le démarrage avec le PC**, que Sami installe lui-même, puisque c'est un réglage permanent de sa machine. Un
  raccourci dans le dossier de démarrage (`Win+R`, `shell:startup`), dont la cible est :
  ```
  cmd /c start "mcts-backlog" /min node "E:\Dev\My projects\mcts-commun\bin\backlog.js" --stay
  ```
  La fenêtre réduite est le lanceur. La fermer l'arrête, et les jobs qu'il laisse reviennent dans la file au démarrage
  suivant (`requeueOrphans`).
- **Le jour aussi** : un lanceur permanent prend un job dès qu'il arrive. Sami (30/10/2026) : les jobs de jour sont
  bienvenus tant que la file reste sous contrôle, 18 fils au plus ; s'il veut le PC pour lui, il coupe le lanceur. Un
  job qui doit attendre la nuit s'ajoute avec `--not-before 2026-10-30T20:00`. La priorité et `due` ne changent pas.
- **Son code** : un lanceur garde le code de `node/` chargé à son démarrage. Après un changement de la file dans
  commun, il faut le relancer pour qu'il le prenne, quand aucun job ne tourne, et seulement avec l'accord de Sami.
- **Le premier** a démarré le 30/10/2026 à 00:30, à la main (la commande du raccourci), sur le code de `c5a6295` :
  il tourne jusqu'à ce que sa fenêtre soit fermée ou le PC éteint. Sami a installé le raccourci le même jour : le
  lanceur repart à chaque ouverture de session.

Pour suivre un job pas à pas, on lit la fin de `output` (le fichier grandit pendant le job) ou de `trace`. On peut
aussi passer par le serveur de la page : `GET /api/backlog` et `GET /api/backlog/tail?id=…&kind=output|trace`, en
lecture seule.

## Ce que disent les traces

Chaque job a sa trace dans `traces/` : `start`, les évènements de la bibliothèque, un `heartbeat` toutes les 30 s
(les compteurs par scope, la mémoire), `end` ou `crash`. Les vues en tirent deux niveaux :

| Niveau | Quoi | Où |
|---|---|---|
| **Alarme** (rouge) | le lanceur mort, un plantage, une erreur tracée (`errors` des compteurs) | « À regarder » sur la page |
| **À surveiller** (jaune) | près de la limite (90 %), trace muette depuis 2 min, des appels lents, des cases réservées deux fois | « À surveiller » |
| **Avancement** | le dernier `progress` du job, et sa fin au rythme depuis son départ | à côté de la barre |

Les seuils, et pourquoi :
- **Un appel lent** dépasse 2 s (`SLOW_MS`) **et** 10 fois la moyenne des appels d'avant de son scope ; un premier
  appel, 20 s. Une recherche de cuisine prend de 0,5 à 6 s selon la cuisine : à 2 s seules, ce matin du 27/10 en a
  marqué 3 391, et le TUI disait « 20 incidents » en rouge sur chaque job. Par cette règle, 13 : les vraies queues
  (une recherche de 38 s où elles en prenaient 1,5).
- **Une case réservée deux fois** (`src/grid.js`) : toutes sont comptées, les 20 premières d'un processus sont
  écrites, avec `clone: true` quand c'est un clone de la recherche qui l'a réservée (`overbookedInClone`). Dans un
  clone, la recherche essaie un coup ; dans le vrai monde, deux unités se croisent : un défaut du projet.
- **Une trace muette** : plus de battement depuis 2 min, alors que le job a déjà appelé la bibliothèque. Un calcul
  bat à chaque appel ; un job qui ne bat plus est coincé dans une boucle hors de la bibliothèque.
- Les compteurs donnent les totaux ; les vues ne gardent que les 20 derniers évènements, pour le détail.
- **Un job arrêté** (annulé, trop long, une garde) est tué avec ses processus : il ne peut pas écrire sa fin. Son
  lanceur l'ajoute à sa trace (`end` avec `stoppedBy: "mcts-backlog"` et le statut), et pour les traces d'avant le
  27/10 les vues la tirent de l'archive : « ■ annulé », jamais « muet » (27/10 : un job annulé à 10:30 restait
  « muet 29 min » dans le TUI).

**A* ou la recherche ?** A* est appelé dans les simulations de la recherche : son temps est compté dans `astar`
**et** dans `search`. La part d'A* dans un job, c'est `astar.ms` sur sa durée ; ce qui reste de `search.ms`, c'est
l'arbre et les simulations hors chemins. `astar.notFound` compte les chemins introuvables : chacun parcourait tout
l'espace-temps jusqu'à son horizon, et c'est là que partait le temps en couloir (une sur deux, 2,5 ms chacune).
Depuis le 27/10, A* s'arrête tôt quand la cible est hors d'atteinte. Une unité garée pour de bon est un mur à partir
du moment où elle se gare (`stayAt`). Le test se fait une fois, quand la recherche a vu autant de nœuds que le plan a
de cases. La réponse est la même, `null`, et `astar.givenUp` compte ces arrêts. Sur la cuisine en couloir, 3 services
des règles : A* passe de 4,6 s à 0,33 s. Au grand détour avec tables, un service de la recherche, de 18,7 s à 8,0 s.
Les empreintes n'ont pas bougé.

Le soir du 27/10, ce test se révèle coûteux sur un plan plus large. Ses couches comptaient une case autant de fois
qu'elle avait de voisins déjà atteints, et grossissaient ainsi à chaque pas (`a9a4c99`) :

| Plan, un coin muré, horizon 80 | Avant | Après |
|---|---|---|
| 13 × 7 | 72 ms | 3 ms |
| 16 × 7 (les quais de l'entrepôt) | 266 ms | 8 ms |
| 24 × 12 | plus de 4 Go de mémoire, arrêté | 12 ms |

On l'a d'abord cru responsable des 38 min de `ligne-retours` (23 annoncées). L'entrepôt a mesuré le soir même, à
charge égale : le correctif ne fait gagner que 8 % sur ses plans (381 s → 352 s pour 10 heures de `retours`). Les
mêmes 10 heures avaient pris 660 s le matin avec 18 jobs côte à côte, et 289 s seules le soir : c'était la machine
chargée. A* fait tout de même 80 % du temps d'une recherche de la ligne.
Ce soir-là, A* coupe aussi les pas d'où la cible n'est plus joignable avant l'horizon. Il compte les cases explorées
(`astar.expanded`), et `expanded / calls` dit ce que coûte un appel. Avec `maxNodes`, les appels plafonnés
sont comptés dans `astar.capped`, et les chemins partiels dans `astar.partial` (le README, « A* borné »).

## Recommandations aux projets

Pour les jobs que cuisine, entrepot, urgences ou lopin mettent dans la file (Sami, 27/10/2026 : un job ne disait rien
pendant 45 min, puis tout à la fin) :

1. **Dire où on en est.** `progress("compare", i + 1, services, { unit: "service" })` de `mcts-commun/trace.js` à
   chaque service, scénario ou vague. Les vues montrent « service 12/30, fin vers 10:20 », et une trace qui avance
   prouve que le job vit. Pour qui lit la sortie, une ligne courte sur la sortie d'erreur (`console.error`), qui
   va dans le même fichier, laisse le tableau final propre sur la sortie standard.
2. **Écrire les résultats au fil de l'eau** (une ligne JSON par service, ajoutée au fichier) : un job arrêté à sa
   limite, par la garde mémoire ou par `--cancel` garde ce qu'il a calculé, et le tableau final se refait à partir
   d'eux.
3. **Des jobs de 30 min au plus**, découpés en tranches (`--services` par tranches, un id par tranche, un job
   d'agrégat avec `after`). Ils se placent mieux dans la nuit, et un échec en coûte moins.
4. **Une estimation et une `limit` honnêtes.** La file apprend les durées des commandes déjà passées, mais une
   commande neuve se fie à l'estimation : une variante lente (une cuisine en couloir) mérite la sienne. `limit` doit
   dépasser le pire cas, sinon le job finit `timeout` ; elle vaut 120 min par défaut.
5. **Respecter `MCTS_THREADS`** (les fils donnés au job), **sortir avec un code non nul** en cas d'échec, et des ids
   datés, jamais réutilisés : à la milliseconde s'ils sont ajoutés en rafale. Un id déjà pris est refusé (code 1, « refusé :
   le job … existe déjà ») ; un script qui ajoute des jobs lit ce code (codingame, 30/10/2026 : deux ids à la seconde,
   le second refusé sans qu'on le voie).

   **Des jobs d'un diviseur de 18 fils** (1, 2, 3, 6 ou 9 ; Sami, 30/10/2026) : le plus proche de ce dont le job a
   besoin. Un job de 10 fils empêchait un job de 9 de tourner à côté, et 8 fils de la machine restaient vides. Deux
   parties à 4 joueurs tiennent dans 9 fils, l'arbitre attendant pendant que les bots réfléchissent.

   **Des tailles qui s'additionnent, et `--min-threads`** (31/10/2026, `bench/scheduler-replay.js`). Le 30/10 rejoué :
   un job de 1 fil à côté des arènes de 9 laissait 8 fils vides tant qu'il durait (9 + 9 + 1 > 18) ; dans la journée,
   27 heures-fils sont restées vides pendant qu'un job attendait, dont 11 où un job qui aurait tenu attendait. Le
   remplissage derrière ses propres jobs en rend 1 ; **`--min-threads N`** en rend la moitié : un job qui accepte de
   partir avec moins de fils que `threads`, jusqu'à N, démarre sur les fils libres quand il manque les siens
   (`MCTS_THREADS` les lui dit ; `runThreads` dans la file, `asked` au journal). Pour une arène dont les parties
   tournent en parallèle, `--threads 9 --min-threads 6` ; pas pour un job dont les fils sont fixes. Et quand la file
   est pleine de jobs de 9, un job de 1 fil coûte 8 fils tant qu'il dure : qu'il parte en même temps que les autres
   jobs de 1 fil de son projet plutôt que seul.
6. **Ne jamais écrire dans `~/.mcts-backlog`** : passer par `mcts-backlog` (`--add-file`, `--status --json`,
   `--wait`).
7. **Lire sa trace après coup** : `--status ID --json` donne `incidents` et `reported` ; une erreur ou une case
   réservée hors clone, c'est à regarder dans le projet. Le dernier battement de la trace (`counters`) dit où passe le
   temps (30/10/2026) : `astar.ms / search.ms` la part d'A*, `rollout.ms`, `play.ms`, `sample.ms` et `copy.ms` celle de
   chaque rappel du problème, `reservations.ms` celle des réservations. Ce qui reste est le code du projet autour de la
   recherche. Le 30/10, la lib chronométrée faisait 10 % d'une recherche de cuisine et 29 % d'une d'entrepôt.
8. **Essayer les réglages du 27/10 au soir** ([`recherche.md`](recherche.md)), éteints par défaut :
   - `earlyStop` sur les recherches à `budget` : le même coup, moins d'itérations. Il se mesure par paires contre la
     recherche actuelle, puisque le hasard consommé change ;
   - `diagnose` sur chaque décision, compté par code : il dit lequel des leviers essayer (le rollout, le score, la
     liste courte) ;
   - `astar.expanded / astar.calls` dans la trace : ce que coûte un appel d'A*.

   Ce qui a été demandé à chaque projet, et pourquoi : [`essais-projets.md`](essais-projets.md).

9. **Ne jamais lancer de calcul à côté de la file sans passer par les créneaux** (Sami, 27/10/2026 : une session lançait
   ses tests à côté d'une file qui tenait déjà les 18 fils). Une mesure longue va dans la file. Un test ou un essai
   court passe par `mcts-backlog --slot N -- commande` : la machine n'a qu'un budget, quel que soit celui qui calcule.
   Windows ne sait pas plafonner un processus : la règle tient parce que tout le monde passe par là. Le hook du tableau
   le rappelle à chaque prompt tant que la file tient des fils : « Machine : 18/18 fils pris… », avec
   `TEST_CONCURRENCY` conseillé.

   **Un test court est court : 4 fils et 15 min au plus** (Sami, 28/10/2026 : « je ne veux plus voir un job d'une
   heure sur 12 fils dans l'onglet des tests »). Un `--slot` de plus de 4 fils est refusé (code 2) : c'est un job,
   il va dans la file (`--add`). À 15 min, le test est arrêté avec tout ce qu'il a lancé (code 124, `stopped` dans
   `slot-ended`, « arrêté : trop long » dans l'onglet Tests). Les vérifications avant un commit tiennent dans 4 fils
   et moins d'une minute ; une mesure qui dépasse 15 min se découpe en jobs.

   **Le test court passe devant** (Sami, 27/10/2026 : un `--slot 1` d'urgences avait attendu 12 min 43 derrière la
   file) :
   - pendant qu'il attend, sa demande est inscrite dans `wanted.json` (`node/wanted.js`). Le lanceur ne démarre plus de
     job sur ces fils : le prochain qui se libère va au test ;
   - s'il manque encore des fils, le lanceur arrête ses jobs **commencés il y a moins de 5 min**, les plus récents
     d'abord (`node/preempt.js`). Ils retournent en file (`job-preempted` au journal, leur trace finie « laissé à un
     test court ») et repartent plus tard, depuis le début ;
   - un job n'est arrêté ainsi que 2 fois au plus, ensuite il est protégé ;
   - le lanceur n'arrête que ses propres jobs, jamais ceux d'un autre lanceur (Lopin).

   Le journal le dit : « place à un test », puis « remis, pour un test ».

   **Les tests courts se voient** (Sami, 28/10/2026) : chaque `--slot` écrit au journal `slot-started` (`id`,
   `threads`, `waitedMin`, `cwd`, `command`) quand il prend ses fils, et `slot-ended` (`id`, `threads`, `minutes`,
   `code`) quand il les rend ; une écriture ratée ne fait jamais échouer le test. L'onglet **8 Tests** de la TUI et la
   carte « Tests courts (créneaux) » de la page montrent ceux qui attendent (`wanted.json`), ceux qui tournent (les
   créneaux `session` de `slots.json`), les 30 derniers finis avec leur code et leur attente, et les jobs de la file
   libérés pour eux (`node/backlog-slots.js`). Un `--slot` d'avant ce jour-là se lit par son id,
   `session:<projet>:<commande>`.

   **Un lanceur qui attend se voit aussi** (28/10/2026, 19 h 40 : la TUI ne montrait que l'essai d'une session, à 6
   fils sur 18). Un lanceur en vie qui ne tient aucun fil reste dans la ligne de la machine, reconnu à ses lignes de
   journal, avec ce qu'il attend : « attend 16 fils pour mondes-32 (12 libres) » (`node/backlog-runners.js`). Il ne
   le dit que quand les créneaux des autres (un `--slot`, un autre lanceur) lui barrent la route : attendre la fin de
   ses propres jobs, c'est une file au travail (29/10/2026 : « attend 1 fils (0 libres) » s'affichait toute la nuit).

   **Un dossier introuvable est refusé à l'ajout** (`--add`, `--add-file`, `--retry`), pour ne pas échouer en pleine nuit
   (urgences, 27/10 : un heredoc avait mangé les antislashs d'un `cwd`).

10. **Les leçons de la journée du 28/10**, tirées des retours d'expérience des six sessions :
    - **mesurer court avant de mettre en file** : un essai de 2 journées sous `--slot`, puis les jobs (l'entrepôt avait
      mis 787 min en file avant sa mesure courte) ;
    - **refaire ses estimations après un gain de vitesse**, et les marquer `--measured` ; elles étaient 8 à 20 fois
      trop longues le 28/10 ;
    - **comparer des temps dans un même job, ou en alternance, à charge égale** : les « 47 % » d'urgences venaient
      surtout de l'ordre des mesures. Compter le temps dans le créneau, pas l'attente du créneau ;
    - **prouver une équivalence avant d'adopter une optimisation** (un hachage des mesures, ou une comparaison à l'octet
      près contre l'ancien code tiré de git) ;
    - **ne rien conclure d'un ou deux services ou journées** : la note graduée de cuisine, promue sur 2 services, ne
      tenait pas ;
    - **`--test-concurrency=4`** dans `npm test` et dans les hooks : `node --test` ne lit pas `TEST_CONCURRENCY` ;
    - **des pools de fils qui lisent `MCTS_THREADS`** et des jobs qui reprennent où ils se sont arrêtés, en
      tranches de 30 min au plus (lopin) ;
    - **un `--id` stable et lisible** pour une série d'essais ;
    - **changer une priorité par `--set-priority`**, pas par des annulations (cuisine en a fait 115).
11. **Le ramasse-miettes des jobs qui allouent** (31/10/2026, [`recherche.md`](recherche.md) § 6) : la jeune
    génération de V8 fixée à 64 Mo, sur la ligne `node` de la commande du job,
    `node --min-semi-space-size=64 --max-semi-space-size=64 scripts/…` (les workers du processus en héritent) :
    −10 % sur les journées du parcours d'urgences, −5 % sur les services de cuisine, rien sur les journées
    d'entrepôt. `--max-semi-space-size` seul ne fait rien, et `--min-semi-space-size` est refusé dans `NODE_OPTIONS` :
    le lanceur ne peut pas le donner à votre place. Le coût : 128 Mo par processus et par worker. À vérifier sur
    votre job de référence avant de l'adopter.
12. **Les vues coûtent peu, et restent à le faire** (31/10/2026) : un tic de la TUI ou de la page (toutes les 2 s)
    lisait tout `done/` (un mégaoctet de JSON) et passait les 957 fichiers de `traces/` en revue, 106 ms ; il en coûte 6
    depuis que l'archive du mois et les résumés de traces ne sont relus que si leur fichier a bougé, et que seules les 60
    traces les plus récentes et celles des jobs en cours sont consultées (`node/backlog-traces.js`). `runs/` et
    `traces/` grossissent d'un fichier par job (1 290 et 957 au 31/10) : un rangement par mois reste à faire.

## Après une nuit : le bilan

Sami (27/10/2026) : faire le tour de la nuit avant que la journée ne remplisse la file. Tout se lit sans rien
écrire.

1. `npx mcts-backlog --list --done 40` : plus de lanceur (`○ aucun lanceur`), rien en cours, et chaque job en échec
   avec sa raison.
2. Les fins de la nuit dans `done/AAAA-MM.json` (`doneAt` après 20 h). Pour chaque job qui n'a pas fini `done`,
   sa cause est dans `journal/` : `cancel-asked`, `job-cancelled`, `memory-stop`, `heat-alert`, `crash` ou
   `orphans-requeued`. Un échec sans cause dans le journal, c'est un job arrêté à la main, ou un bug.
3. `slots.json` vide et aucun job `running` dans `queue.json` une fois tous les lanceurs partis. Sinon, un lanceur
   est mort en route : les vues le montrent « lanceur mort », et le prochain lanceur remet ses jobs dans la file.
4. `traces/` : une trace par job, qui commence par `start` au lancement et finit par `end` (ou `crash`), avec un
   `heartbeat` toutes les 30 s entre les deux dès que le job appelle la bibliothèque.
5. `npm run check`, puis la file essayée de bout en bout sur un `--home` temporaire, **jamais la vraie** :

```bash
H=$(mktemp -d); W=$(mktemp -d)
printf 'setTimeout(() => process.exit(Number(process.argv[3] ?? 0)), process.argv[2] * 1000);
' > "$W/dort.mjs"
B="node bin/backlog.js --home $H"
$B --add a --cwd "$W" --estimate "1 min" -- node dort.mjs 3
$B --add b --cwd "$W" --estimate "1 min" --after a -- node dort.mjs 1        # attend a
$B --add c --cwd "$W" --skip-if "node -e 0" -- node dort.mjs 1               # sauté
$B --add d --cwd "$W" --estimate "10 min" -- node dort.mjs 600               # annulé en cours
$B --add e --cwd "$W" --priority 1 -- node dort.mjs 1 3                      # passe en premier, échoue
MCTS_BACKLOG_POLL_MS=500 $B --budget 2 &
sleep 3; $B --cancel d
for id in b c d e; do $B --wait $id --timeout 1; echo "$id → $?"; done      # 0, 2, 2, 1
wait; $B --add vrai --cwd ../mcts-entrepot -- npm run compare -- --plan petit --days 3 --search
$B; cat "$H"/traces/*_vrai.jsonl                                             # start, heartbeat…, end
```

### La nuit du 26 au 27/10

Le lanceur 29368, qui tournait avec le code d'avant le verrou, s'est arrêté seul à 05:43, après son
dernier job : la file vide, aucun fil pris. 253 jobs ont fini depuis 20 h, dont 209 lancés par lui :
- **193 jobs finis**, et aucun id en double dans l'archive ;
- **15 échecs, tous expliqués** : 12 jobs cuisine `-soir` arrêtés à la main à 21:36, l'ancien lanceur ignorant
  `--cancel` ; 3 jobs entrepot arrêtés à 22:24, qui ne finiraient pas avant leurs 180 min (Sami les relance en
  segments). Aucun échec après 22:30 ;
- **1 dépassement** : `ligne-jeu-retours` (lopin), lancé à 15:16, arrêté à ses 300 min ;
- **44 annulés** par `--cancel` à 22:59 : les jobs entrepot `-90s`, remplacés par les `ent-quais-*` ajoutés à 22:50.

Deux lanceurs du nouveau code, démarrés par d'autres sessions (21:25 et 23:16), ont trouvé les 18 fils pris et
n'ont rien lancé ; ils sont partis avec leur session, sans écrire `runner-ended`. L'ancien lanceur n'écrivait ni
journal ni traces : la nuit n'en a pas. Il reste un `queue.json.tmp` du 23/10, écrit par le code d'avant et que plus
rien ne lit.

Le bilan du matin a trouvé trois défauts, corrigés le 27/10 :
- **Une trace n'était écrite qu'à la fin du job.** Le fichier de trace s'ouvre par un import dynamique, qui n'aboutit
  que quand le script rend la main ; un calcul d'un seul tenant ne la rend jamais. Aucun battement non plus : aucun
  minuteur ne tourne pendant un tel calcul. Le TUI et la page auraient dit « muette » tout le long de chaque job.
  Le lanceur ouvre maintenant la trace avant le code du job (`NODE_OPTIONS=--import`, `node/trace-preload.js`, npm
  et npx exclus), et ce sont les appels à la bibliothèque qui battent (`onPulse` de `src/trace.js`). Vérifié sur un
  vrai `compare` de l'entrepôt : `start` au lancement, un battement par seconde (en test) pendant le calcul.
- **`--help` lançait un lanceur**, sur la vraie file (vide ce matin-là, sans effet). Une option inconnue est
  maintenant refusée, et `--help` répond.
- **`--add … -- node -e "…"` perdait ses guillemets** : le shell coupait le code. Les mots après `--` gardent les
  leurs.

Et une demande de Sami : **des estimations tirées de ce qui a déjà tourné** (§ « Un job », `src/estimate.js`).
Rejouées sur les 292 jobs finis, chacun estimé avec ce qui était fini avant son départ :

| | Écart médian à la durée réelle | 1 job sur 5 au-delà de |
|---|---|---|
| Les estimations des projets | ×2,9 | ×5,5 |
| Les estimations apprises | ×1,5 | ×2,7 |
| La nuit du 26/10 seule, apprises | ×1,4 | ×2,0 |

L'ordre du lanceur, la fin prévue et la charge les prennent ; `--list`, le TUI et la page disent l'estimation
annoncée à côté (« annoncé 6 h 00, appris de 1 passage »). Elles sont mesurées à 18 jobs côte à côte : seul, un job
va plus vite.

### Le matin du 27/10 : les premières traces

Les 32 jobs cuisine lancés à 09:12 (`compare`, référence, `--search`) sont les premiers à avoir une trace du départ
à la fin. Tous ont fini `done`, sans erreur ni plantage, avec un battement toutes les 30 s pendant tout leur
calcul (aucun trou plus long) et une mémoire stable autour de 110 Mo : l'ouverture de la trace avant le job marche.

**La recherche prend le temps** : de 85 à 94 % de chaque job. A* en est une partie, de 20 à 45 % du job, sauf :

| Cuisine | Part d'A* dans le job | A* sans chemin | Temps par appel d'A* |
|---|---|---|---|
| `couloir` (`random`, `urgent`) | 93 à 95 % | 48 à 51 % de 780 000 appels | 2,5 ms |
| `tables-detour` | 77 % | 54 600 appels | 0,8 ms |
| `separee` (pour comparer) | 20 à 25 % | aucun | 0,07 ms |

Sur couloir, un A* sur deux ne trouve pas de chemin et parcourt tout jusqu'à son horizon : c'est là que part le
temps, et pourquoi `couloir` a pris 42 min pour 10 annoncées. **Corrigé le jour même dans mcts-commun** (`1c37ffc`,
§ « Ce que disent les traces ») : quand la recherche a vu autant de nœuds que le plan a de cases, A* vérifie une
fois si la cible est atteignable avant l'horizon (les unités garées pour de bon comptées comme des murs, `stayAt`),
et renonce sinon. Même réponse, `null`, compté dans `astar.givenUp` ; les mêmes plats à l'heure et les empreintes
inchangées. Mesuré par la session cuisine :

| Mesure | Avant | Après |
|---|---|---|
| A* sur 3 services des règles, couloir | 4,6 s | 0,33 s |
| A* sur 1 service de la recherche, grand détour avec tables | 18,7 s | 8,0 s |
| Ce même service en tout | 36 s | 26 s |

Les durées apprises de ces commandes (la médiane de leurs 5 derniers passages) restent celles d'avant pendant
quelques passages : la file surestimera couloir et tables-detour jusqu'à ce que les nouveaux passages les remplacent.
Le prochain lot dira le gain réel, à 18 jobs côte à côte, par `astar.givenUp` et la part d'A* dans chaque trace.
Le correctif du soir (`a9a4c99`, § « A* ou la recherche ? ») touche surtout l'entrepôt, aux plans plus larges.

**Les alertes ne disaient rien** : 3 391 recherches « lentes » (de 2 à 38 s, budget 64, profondeur 2), le TUI à
« 20 incidents » en rouge sur presque chaque job. D'où la règle relative et les deux niveaux (§ « Ce que disent les
traces »). **Des cases réservées deux fois** dans 16 jobs, jusqu'à 331 dans `plonge-urgent`, souvent la même case
répétée en quelques dixièmes de seconde : sans doute les clones de la recherche, mais la trace ne le disait pas ;
elle le dit maintenant (`clone`). **Aucun job ne disait où il en était** : la sortie de `tables-detour` est restée
sur l'en-tête de son tableau pendant 45 min. D'où `progress` et les recommandations aux projets.

### Le 28/10 : les mesures des projets, et une file qui se compare

- **Une annulation n'est pas un échec.** Le 28/10 à 14 h, `--list` disait « 0 fini, 115 en échec » : c'étaient les
  115 jobs que cuisine avait annulés (`cancel-asked` au journal). Les vues comptent maintenant à part les échecs
  (`failed`, `timeout`) et les annulés ; `--list --json` donne `counts.failedToday`, `counts.cancelledToday` et
  `counts.endedToday` (tous les jobs finis du jour, sautés compris).
- **La durée d'un job dépend de la charge** (l'entrepôt) : une tranche prend environ 2,3 fois plus de temps quand 18
  jobs tournent que seule. Deux durées se comparent donc à charge égale. Le 0,43 de `load.estimateRatio` (le réel
  sur l'estimé) vient surtout des estimations des projets, faites avant `earlyStop` ; l'entrepôt a refait les siennes.
- **Un lanceur remplacé laisse ses jobs orphelins** (lopin, 27/10 à 21:11) : le job écrivait vers le lanceur mort et a
  planté sur un EPIPE, puis le lanceur suivant l'a remis en file, et il a fini au second passage. Rien n'est perdu,
  mais le premier passage est du calcul en trop.
- **Comparer une file avant et après un correctif de la lib** : les durées mêlent les gains des projets et ceux de la
  lib, et la charge. La part de la lib se lit dans les compteurs de la trace de chaque job (`counters.astar.ms /
  calls`, `expanded / calls`, `givenUp` ; `counters.search.ms / calls`), job par job, contre ceux d'un passage
  précédent de la même commande. La lib ne change pas pendant que la file tourne : un job qui démarre après un
  correctif ne se compare plus à ceux d'avant.

### Le 28/10 au soir : la file de jour, et une série de `--slot` qui l'a ralentie

La file lancée à 18 h 31, d'un commun accord, sur la lib `684c3ad` et Node 24 : **167 jobs finis à 20 h 00, aucun
en échec** (cuisine 130 de 18 h 31 à 19 h 05, urgences 22, l'entrepôt 15), en 1 h 29 au lieu des 3 h 27 annoncées :
les estimations dataient d'avant les gains de vitesse (8 à 20 fois trop longues chez cuisine).

**De 19 h 04 à 19 h 44, la machine a tourné à 6 fils sur 18** (40 % des fils vides en moyenne depuis 18 h 45) :
- le job suivant, `mondes-16` puis `mondes-32` d'urgences, voulait 16 fils ;
- l'arène de codingame enchaînait des `--slot 6` de 5 à 8 min, chacun relancé aussitôt : 6 + 16 > 18 ;
- chaque `--slot` arrêtait le job de 16 fils tout juste lancé (4 fois, chacun reparti de zéro), jusqu'à sa
  limite de 2 arrêts ; ensuite le job attendait que l'arène rende ses fils ;
- le lanceur ne démarre les jobs que dans l'ordre : les `diagnose` de 8 fils, qui tenaient dans les 12 libres,
  attendaient derrière ;
- les vues ne montraient pas le lanceur, qui ne tenait aucun fil : la TUI ne disait que « session 33724 ».

Réglé par une pause de codingame (19 h 44), à la demande de Sami ; ses séries passeront à 3 fils. Les vues montrent
maintenant un lanceur qui attend, et ce qu'il attend (`074119c`). **Corrigé dans le lanceur le soir même** (Sami,
28/10, la file vide) :
- **Les trous se remplissent** (`node/fill.js`). Quand le job suivant attend les fils d'un `--slot` ou d'un autre
  lanceur, un job prêt qui tient dans les fils libres et dure 15 min au plus (d'après ce que la file a appris)
  démarre en attendant. Le journal le dit : `gap-filled` (« trou rempli »). Le 28/10, les `diagnose` de 8 fils
  auraient tourné pendant l'arène. **Depuis le 31/10**, quand le suivant attend les propres jobs du lanceur, un job
  prêt démarre aussi s'il lui laisse son départ : il finit avant que le suivant puisse partir, ou il lui laisse ses fils
  à ce moment-là (le « backfilling EASY » des ordonnanceurs de grappes). Une suite de petits jobs ne peut plus le tenir
  dehors : chacun doit tenir dans ce que le suivant n'occupera pas.
- **Une série de `--slot` attend comme un job** (l'avis de codingame) : un `--slot` relancé moins de 2 min après la
  fin d'un autre du même id (`--id`, ou l'id par défaut : le dossier et la commande) est `series` dans
  `wanted.json`. Il ne retient plus les jobs suivants et n'en arrête aucun : il prend les fils quand ils se libèrent.
  L'onglet Tests dit « en série ».
- `slot-waiting` est réécrit chaque fois qu'un job se remet à attendre, après un arrêt par exemple.
- Les vues trouvent le vrai démarrage d'un lanceur dans tout le journal, une fois par lanceur.

### Le 29/10 : ce que les retours d'expérience ont demandé à la file

Sami a demandé à chaque session son retour d'expérience de la journée du 28/10. Ce qui en est venu pour la file :
- **`--measured`** : une estimation refaite sur le code du jour n'est plus corrigée par le rythme de jobs plus anciens
  (cuisine) ;
- **`--set-priority MOTIF N`** et **`--retry ID --priority N`** : une priorité se change sans annuler (cuisine) ;
- **le shell `cmd.exe` est dit** dans l'aide de `--slot` et dans § « Un job » (lopin, cuisine) ;
- **un lanceur n'est plus dit « en attente »** quand il attend la fin de ses propres jobs ;
- les leçons communes, dans la recommandation 10.

Le soir, Sami a demandé un lanceur permanent (codingame) : **`--stay`** et **`--not-before`**, § « Un lanceur
permanent ».

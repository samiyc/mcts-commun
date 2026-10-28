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
  (urgent), 2 (normal) ou 3 (peut attendre).
- **`after`** liste les ids qui doivent être finis avant. `due` est l'heure où le résultat doit être là. `limit` est
  la durée maximale en minutes : au-delà, le job est arrêté et finit `timeout`.
- **`skipIf`** est une commande du projet, lancée dans `cwd` juste avant le job. Si elle sort à 0, le job est
  `skipped`, et la première ligne qu'elle a écrite en donne la raison. Elle reçoit `MCTS_BACKLOG_HOME`. lopin s'en
  sert pour ses duels : une série partie trop bas s'arrête là.
- **Les statuts** : `todo`, `scheduled` (avec `notBefore`), `running`, puis une fin parmi `done`, `failed`,
  `timeout`, `skipped` et `cancelled`. Un job fini part dans `done/`.
- Le job reçoit `MCTS_THREADS` (ses fils), `MCTS_TRACE_FILE` (sa trace), `MCTS_BACKLOG_HOME`, et dans
  `NODE_OPTIONS` un `--import` qui ouvre sa trace avant ses propres modules (`node/trace-preload.js`).
- **La commande** après `--` : un seul mot est la ligne telle quelle pour le shell (`-- "npm run x -- --a 1"`) ;
  plusieurs mots sont mis bout à bout, chacun entre guillemets s'il contient un espace ou un caractère du shell
  (`-- node -e "console.log('a b')"` garde son code).

## Les commandes

| Commande | Ce qu'elle fait | Sortie | Code |
|---|---|---|---|
| `--add ID --cwd DOSSIER [options] -- COMMANDE` | ajoute un job. Options : `--estimate`, `--threads`, `--priority`, `--after A,B`, `--due`, `--limit`, `--skip-if` | une ligne | 0, ou 1 si refusé (id pris, champ manquant, dossier introuvable) |
| `--add-file PROJET/night.json [--tag T | --no-tag]` | ajoute les jobs d'un fichier, chaque id suffixé de `-T` (la date du jour par défaut ; `--no-tag` garde les ids), chacun lancé dans son `cwd` (relatif au fichier, son dossier par défaut) | une ligne par job | 0 ou 1 |
| `--status ID [--json]` | où en est un job : à venir (`plannedStart`, ou `waiting` et `blocked`), en cours, fini (`status`, `reason`, `minutes`) ; `output` et `trace` en chemins absolus ; tiré de sa trace, `incidents` (`errors`, `crashed`, `slow`, `overbooked`) et `reported` (le dernier `progress` : `done`, `of`, `unit`, `endAt`) | une ligne, ou un objet JSON (`null` si l'id est inconnu) | 0, ou 3 si l'id est inconnu |
| `--wait ID [--timeout MIN] [--json]` | attend la fin du job, en relisant la file toutes les 2 s | comme `--status` | 0 fini, 1 échec ou trop long, 2 annulé ou sauté, 3 inconnu, 4 pas fini au bout de `--timeout` |
| `--cancel ID` | un job à venir finit `cancelled` tout de suite, et ceux qui en dépendent sont bloqués ; un job en cours est marqué, et son lanceur l'arrête | une ligne | 0, ou 3 si l'id est inconnu |
| `--retry ID` | remet un job fini dans la file sous `ID-r1` (puis `-r2`…) : même commande, même dossier, sans ses prérequis ni son échéance | une ligne | 0, ou 1 s'il n'est pas fini |
| `--slot N [--id NOM] -- COMMANDE` | lance un test ou une mesure **hors file** dans N fils des créneaux de la machine : attend qu'ils soient libres (servi avant les jobs suivants de la file, voir la recommandation 9), lance la commande au premier plan avec `MCTS_THREADS=N`, puis les rend | la sortie de la commande ; une ligne sur la sortie d'erreur tant qu'il attend | celui de la commande |
| `--push MACHINE`, `--pull MACHINE`, `--list --machine MACHINE` | une autre machine : les jobs marqués `--machine MACHINE` (sur `--add` ou `--add-file`) y partent, sa file se lit d'ici, ses résultats reviennent ([`distant.md`](distant.md)) | des lignes, ou la vue JSON de là-bas | 0, ou 1 si la machine est inconnue ou injoignable |
| `--help` | l'aide ; une option inconnue est refusée (code 1) et ne lance jamais de lanceur | du texte | 0 |
| `--list --json` | toute la vue : la machine, les jobs en cours, la nuit à venir, les bloqués, les finis, le journal, les traces | un objet JSON | 0 |

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
   datés, jamais réutilisés.
6. **Ne jamais écrire dans `~/.mcts-backlog`** : passer par `mcts-backlog` (`--add-file`, `--status --json`,
   `--wait`).
7. **Lire sa trace après coup** : `--status ID --json` donne `incidents` et `reported` ; une erreur ou une case
   réservée hors clone, c'est à regarder dans le projet.
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
   journal, avec ce qu'il attend : « attend 16 fils pour mondes-32 (12 libres) » (`node/backlog-runners.js`).

   **Un dossier introuvable est refusé à l'ajout** (`--add`, `--add-file`, `--retry`), pour ne pas échouer en pleine nuit
   (urgences, 27/10 : un heredoc avait mangé les antislashs d'un `cwd`).

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
maintenant un lanceur qui attend, et ce qu'il attend (`074119c`). **À faire dans le lanceur** (Sami, 28/10) :
remplir les trous avec les jobs qui tiennent dans les fils libres quand le suivant attend ceux d'un `--slot` ; compter
une série de `--slot` qui se relance aussitôt comme un job, pas comme un test court (l'avis de codingame) ;
réécrire `slot-waiting` après chaque arrêt (le lanceur ne l'écrit qu'une fois par job) ; retrouver son vrai
démarrage dans les vues.

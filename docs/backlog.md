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
| `--add ID --cwd DOSSIER [options] -- COMMANDE` | ajoute un job. Options : `--estimate`, `--threads`, `--priority`, `--after A,B`, `--due`, `--limit`, `--skip-if` | une ligne | 0, ou 1 si refusé (id pris, champ manquant) |
| `--add-file PROJET/night.json [--tag T | --no-tag]` | ajoute les jobs d'un fichier, chaque id suffixé de `-T` (la date du jour par défaut ; `--no-tag` garde les ids), chacun lancé dans son `cwd` (relatif au fichier, son dossier par défaut) | une ligne par job | 0 ou 1 |
| `--status ID [--json]` | où en est un job : à venir (`plannedStart`, ou `waiting` et `blocked`), en cours, fini (`status`, `reason`, `minutes`) ; `output` et `trace` en chemins absolus | une ligne, ou un objet JSON (`null` si l'id est inconnu) | 0, ou 3 si l'id est inconnu |
| `--wait ID [--timeout MIN] [--json]` | attend la fin du job, en relisant la file toutes les 2 s | comme `--status` | 0 fini, 1 échec ou trop long, 2 annulé ou sauté, 3 inconnu, 4 pas fini au bout de `--timeout` |
| `--cancel ID` | un job à venir finit `cancelled` tout de suite, et ceux qui en dépendent sont bloqués ; un job en cours est marqué, et son lanceur l'arrête | une ligne | 0, ou 3 si l'id est inconnu |
| `--retry ID` | remet un job fini dans la file sous `ID-r1` (puis `-r2`…) : même commande, même dossier, sans ses prérequis ni son échéance | une ligne | 0, ou 1 s'il n'est pas fini |
| `--push MACHINE`, `--pull MACHINE`, `--list --machine MACHINE` | une autre machine : les jobs marqués `--machine MACHINE` (sur `--add` ou `--add-file`) y partent, sa file se lit d'ici, ses résultats reviennent ([`distant.md`](distant.md)) | des lignes, ou la vue JSON de là-bas | 0, ou 1 si la machine est inconnue ou injoignable |
| `--help` | l'aide ; une option inconnue est refusée (code 1) et ne lance jamais de lanceur | du texte | 0 |
| `--list --json` | toute la vue : la machine, les jobs en cours, la nuit à venir, les bloqués, les finis, le journal, les traces | un objet JSON | 0 |

Pour suivre un job pas à pas, on lit la fin de `output` (le fichier grandit pendant le job) ou de `trace`. On peut
aussi passer par le serveur de la page : `GET /api/backlog` et `GET /api/backlog/tail?id=…&kind=output|trace`, en
lecture seule.

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

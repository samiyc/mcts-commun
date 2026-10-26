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
- **`estimate`** (« 40 min », « 1 h 30 ») sert à l'ordre et à la frise. `priority` vaut 1 (urgent), 2 (normal) ou 3
  (peut attendre).
- **`after`** liste les ids qui doivent être finis avant. `due` est l'heure où le résultat doit être là. `limit` est
  la durée maximale en minutes : au-delà, le job est arrêté et finit `timeout`.
- **`skipIf`** est une commande du projet, lancée dans `cwd` juste avant le job. Si elle sort à 0, le job est
  `skipped`, et la première ligne qu'elle a écrite en donne la raison. Elle reçoit `MCTS_BACKLOG_HOME`. lopin s'en
  sert pour ses duels : une série partie trop bas s'arrête là.
- **Les statuts** : `todo`, `scheduled` (avec `notBefore`), `running`, puis une fin parmi `done`, `failed`,
  `timeout`, `skipped` et `cancelled`. Un job fini part dans `done/`.
- Le job reçoit `MCTS_THREADS` (ses fils), `MCTS_TRACE_FILE` (sa trace) et `MCTS_BACKLOG_HOME`.

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
| `--list --json` | toute la vue : la machine, les jobs en cours, la nuit à venir, les bloqués, les finis, le journal, les traces | un objet JSON | 0 |

Pour suivre un job pas à pas, on lit la fin de `output` (le fichier grandit pendant le job) ou de `trace`. On peut
aussi passer par le serveur de la page : `GET /api/backlog` et `GET /api/backlog/tail?id=…&kind=output|trace`, en
lecture seule.

## Le lanceur qui tournait avant le 26/10

Il ne prend pas le verrou et ne connaît ni `cancel`, ni `skipIf`, ni le statut `cancelled`. Les ajouts sont déjà
protégés entre eux. Ils le seront aussi contre ses propres écritures une fois qu'il aura redémarré. D'ici là :
- un `--cancel` sur un job à venir marche ;
- sur un job en cours, la marque attend le nouveau lanceur ;
- un `skipIf` n'est pas encore lu ;
- un job marqué `--machine` serait lancé ici. On n'envoie donc rien à une autre machine avant son redémarrage.

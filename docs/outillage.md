# L'outillage de mcts-commun

Sami (26/10/2026) : les projets `mcts-*` avaient reçu leur outillage le matin même, et la bibliothèque commune
était restée sans rien. C'est le même outillage que les projets, décrit dans
[`mcts-urgences/docs/outillage.md`](../../mcts-urgences/docs/outillage.md). Cette page ne garde que ce qui change
ici.

## Les commandes

| Commande | Ce qu'elle fait |
|---|---|
| `npm run check` | le lint, les types, puis les tests ; c'est ce que lance le hook avant chaque commit |
| `npm run lint` (`lint:fix`) | eslint, avec le budget de complexité de lopin |
| `npm run types` | tsc vérifie le JavaScript d'après son JSDoc, sans rien compiler |
| `npm test` (`test:coverage`) | les tests, dont les empreintes et la longueur des `.md` |

`npm install` active le hook (`git config core.hooksPath .githooks`). `npm test` et le hook lancent **4 fichiers de
test à la fois au plus** (`--test-concurrency=4`), les fils d'un `--slot` (28/10/2026) : seul, `node --test` en lance
autant que de cœurs moins un, et il ne lit pas `TEST_CONCURRENCY` (l'entrepôt). Pendant des mesures, `TEST_CONCURRENCY=2`
en lance moins dans le hook.

## Ce qui diffère des projets

- **`node/` et `bin/` passent aussi sous le budget.** Ce sont les outils de la backlog : le lanceur, le TUI, le
  serveur de la page. `src/` et `web/` n'importent aucun module `node:*`, parce que la page les charge.
- **Les empreintes couvrent ce dont dépendent les projets.** `tests/api.test.js` garde celle de la recherche.
  `tests/fingerprint.test.js` garde celles de la grille (sept unités planifiées les unes autour des autres), de
  l'ordonnanceur (une nuit de douze jobs) et de la file d'événements. Une refonte ne doit en changer aucune.
- **Les types** : `tsconfig.json` couvre `src/`, `node/`, `bin/` et `web/`. Les formes échangées sont dans
  `src/types.js` : le monde et le coup (ceux du projet), et le job de la file.

## Le premier passage, le 26/10

Le lint a trouvé 118 erreurs, les types 20. On a découpé, sans relever une seule limite :
- `node/tui.js` en cinq modules : `ansi`, `tui-tabs`, `tui-detail`, `tui-screen`, et la boucle des touches ;
- `bin/backlog.js` en `node/queue.js`, `node/run-job.js`, `node/runner.js` et `node/backlog-commands.js` ;
- la page en un module par section (`web/backlog-*.js`) ;
- dans la bibliothèque, `grid.js`, `events.js` et `mcts.js` en fonctions plus petites.

Aucune empreinte n'a bougé, ni ici ni dans les trois projets. Le découpage a été fait dans un worktree à part, parce
que la backlog tournait : un job qui démarre charge `src/` tel qu'il est sur le disque.

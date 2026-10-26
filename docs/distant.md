# Une machine en plus : serveur loué, portable

Sami (26/10/2026) : avec trois projets `mcts-*`, et d'autres à venir, les 18 fils du PC risquent de ne plus suffire
aux jobs de nuit. Cette page reprend l'analyse de lopin du 03/10 (`lopin/docs/cloud.md`) et l'étend à tous les
projets : `mcts-backlog` peut envoyer une partie de la file à une autre machine, puis en rapatrier les résultats.

## D'abord, mesurer

On ne loue rien avant d'avoir vu que la machine sature. `npx mcts-backlog --list`, le TUI et la page
(`npm run page`) affichent la charge :
- **ce que demande la file**, en heures de la machine entière, selon les estimations des jobs ;
- **ce qu'elle demande au rythme mesuré**, parce que les estimations sont souvent larges : le soir du 26/10, les jobs
  prenaient 0,19 de leur estimation ;
- **si elle tient avant 8 h**, ou combien de temps elle déborderait ;
- **les nuits passées** (section « Les nuits passées » de la page) : la part de la machine occupée de 20 h à 8 h, et
  ce qui a tourné après 8 h.

**Quand passer à une machine en plus** : quand des nuits occupées à plus de 95 % ou débordant après 8 h se
répètent, au rythme mesuré et pas seulement selon les estimations. Une nuit chargée de temps en temps se résout en
décalant des jobs (`--priority 3`, `--due`).

## Ce que ça coûte

Ordres de grandeur relevés par lopin le 03/10/2026, **à vérifier sur les pages de tarifs** avant de louer :

| Offre | Machine | Prix approximatif | Une nuit de 8 h |
|---|---|---|---|
| **Hetzner Cloud, vCPU dédiés (CCX)**, recommandé | 16 à 48 vCPU | ≈ 0,15 à 0,60 €/h | ≈ 1,5 à 5 € |
| AWS ou Google Cloud, instances « spot » | 32 vCPU | ≈ 0,5 à 0,8 $/h | ≈ 4 à 7 $ |
| AWS ou Google Cloud, à la demande | 32 vCPU | ≈ 1,3 à 1,8 $/h | ≈ 10 à 15 $ |

- **Des vCPU dédiés.** Sur des vCPU partagés, le voisin ralentit le calcul, et les mesures « à la montre » deviennent
  fausses.
- **Un serveur se paie tant qu'il existe, même éteint.** À la fin d'un lot, on le supprime.
- **Le PC fixe** (12 cœurs, 24 fils) fait à peu près le travail d'une machine de 32 vCPU dédiés.
- **Le portable** (4 cœurs, 8 fils) en fait environ le tiers : on lui confie des jobs courts.

## Ce que Sami fait, et ce qui demande son accord

Claude ne le fait pas à sa place :
1. créer le compte chez l'hébergeur et y entrer le moyen de paiement ;
2. coller la clé publique dans la console. Claude peut générer la paire sur le PC (`ssh-keygen -t ed25519 -f
   ~/.ssh/mcts_cloud`) ; la partie privée ne quitte jamais le PC ;
3. pour que Claude crée et supprime les serveurs lui-même, installer `hcloud` et le connecter en tapant soi-même le
   jeton (`hcloud context create mcts`). Claude ne manipule jamais le jeton.

**Créer un serveur et le supprimer demandent l'accord de Sami à chaque fois** : Claude annonce la machine, le prix
horaire et la durée prévue, puis attend un oui.

Le serveur : Ubuntu 24.04, la clé SSH, un pare-feu qui n'ouvre que le port 22, et Node 20
(`curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs`). Rien
d'autre : les projets n'ont que `mcts-commun` comme dépendance pour tourner.

## Déclarer la machine

`~/.mcts-backlog/machines.json`, sur ce PC seulement, sans secret (un chemin de clé, pas la clé) :

```json
{
  "cloud": { "ssh": "root@203.0.113.7", "key": "~/.ssh/mcts_cloud", "dir": "mcts", "budget": 46 },
  "portable": { "ssh": "sami@portable.local", "dir": "mcts", "budget": 5 }
}
```

`budget` donne les fils que le lanceur de là-bas peut prêter. Sans lui, la règle du PC s'applique : tous les cœurs
moins 3, 18 au plus. C'est trop peu pour un serveur de 48 vCPU. Une machine peut aussi être un dossier
(`{ "folder": "D:/partage" }`) : c'est ce que font les tests.

## Un lot, pas à pas

```bash
npx mcts-backlog --add-file ../mcts-cuisine/night.json --machine cloud   # ou --add … --machine cloud
npx mcts-backlog --push cloud            # envoie mcts-commun, les dossiers des projets, les jobs, et lance le lanceur là-bas
npx mcts-backlog --list --machine cloud  # la file de là-bas (--json aussi)
npx mcts-backlog --pull cloud            # rapatrie sorties, traces, journal ; les jobs finis le sont ici aussi
```

- **Ici**, les jobs `--machine cloud` ne sont pas lancés par le lanceur local. La vue les montre en attente, « pour
  cloud » puis « sur cloud, envoyé à 21:30 ».
- **`--push`** envoie le dossier de chaque projet sans `node_modules`, `.git`, `logs`, `tmp` ni `coverage`, et
  refait le lien `node_modules/mcts-commun`. Les dossiers hors git dont un job a besoin partent avec, comme
  `duels/` de lopin. Là-bas, la file est dans `<dir>/home`.
- **`--pull`** range ce qui revient dans `~/.mcts-backlog/machines/cloud/`. Il marque les jobs finis avec ce qu'ils
  ont fait, et il recopie dans le projet les fichiers qu'un job nomme dans `returns` (des chemins de son projet, comme
  `"returns": ["data/mesures.json"]`). **Relire ces fichiers avec `git diff` avant tout commit.**
- On relance `--pull` tant que la vue de là-bas montre des jobs. Ensuite, Sami supprime le serveur.

## Ce que ça ne fait pas

- **Un job ne se partage pas entre deux machines.** Un job qui garde un état sur la machine qui calcule (l'oracle de
  lopin) ne doit pas tourner des deux côtés.
- **Le transport ssh n'a pas encore tourné contre un vrai serveur.** Les tests jouent la machine distante dans un
  dossier, avec les mêmes commandes. Le premier lot réel servira de vérification.

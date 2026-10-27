# Les essais demandés aux projets (27/10/2026 au soir)

Sami : « mettre à jour les docs et me donner un prompt pour chacune des quatre sessions (cuisine, entrepôt,
urgences, CodinGame), pour qu'elles testent la correction des bugs ou la prise en compte des nouvelles features ;
ça sera probablement suivi de jobs dans la file de jour. »

**Ce qui a changé dans mcts-commun ce soir-là** (`docs/recherche.md`) :
- **`a9a4c99`, le correctif d'A\*** : le test « cible hors d'atteinte » de `1c37ffc` grossissait de façon
  exponentielle sur un plan large. Sur un coin muré, il faut 266 ms → 8 ms sur 16 × 7, et 24 × 12 ne sature plus
  la mémoire. Les mêmes réponses.
- **`4abc577`, les réglages** :
  - pour A\*, `horizon` coupe pour de bon, et `maxNodes`, `partial` et le compteur `astar.expanded` sont nouveaux ;
  - pour la recherche, `widening` et `earlyStop` sont nouveaux ;
  - le résultat gagne `iterations`, `depth`, `levels` et `ms`, et `diagnose` est nouveau.

  Tous les réglages sont éteints par défaut : les empreintes des projets ne doivent pas bouger.

Les projets lisent la lib par un lien (`node_modules/mcts-commun` → `../mcts-commun`) : ils ont le nouveau code
sans rien installer. Chaque prompt se suffit à lui-même, pour être collé tel quel dans sa session.

Les réglages actuels des projets expliquent ce qu'on attend :
- La recherche tourne à `depth 2`, `width 4`, avec un `budget` de 64 à 100. L'élargissement (`widening`) n'y a
  presque pas de prise : on ne l'essaie que si `diagnose` dit `shallow`.
- `earlyStop` peut épargner une part des itérations quand un coup se détache vite.

Un tag de série (`essais-commun-AAAA-MM-JJ`) est partagé par tous les projets : chacun retrouve ses jobs par le
préfixe de ses ids (`cuis-…`, `essai-…`), pas par le tag seul (cuisine, 27/10).

## Ce qu'ils ont répondu (27/10, 19:24 à 19:53, par le tableau)

| | cuisine | entrepôt | urgences |
|---|---|---|---|
| empreintes | inchangées (92 tests) | inchangées | inchangées (114 tests) |
| le correctif d'A* | rien de visible : plans petits | mêmes chiffres à l'identique ; −8 % sur la ligne, rien sur l'assemblage | sans grille |
| `earlyStop` | mêmes résultats au service près, 13 à 28 % d'itérations et 23 % du temps de recherche en moins | 47 itérations par décision au lieu de 64 sur le bord étroit ; verdict sur 100 heures en file | aucun choix changé, 0 à 2 % d'itérations en moins |
| `diagnose` | `closeCall` 56 à 91 %, puis `fewIterations` ; au banquet `flatScore` 45 % | `closeCall` 73 à 100 %, `fewIterations` 82 % (plan de Sami), `flatScore` à l'usine | `closeCall` 95 à 99 %, `flatScore` 94 % sur les lits d'aval |
| `widening` | pas essayé (`shallow` 0 à 9 %) | pas de `shallow` | `shallow` sur les lits seuls |

Ce qu'il en ressort pour la lib :
- **`closeCall` sort presque partout** : sa borne `p(1 − p)` est la plus large autour de 50 %, et elle ignore les
  mondes communs, où les deux coups se comparent sur les mêmes mondes. Il dit peu tel quel (urgences, entrepôt).
- **`fewIterations` sort sur les recherches qu'`earlyStop` a arrêtées exprès** (40 % au bord étroit de l'entrepôt).
- **Le temps (`ms`) favorise la ligne jouée en second**, au code déjà chaud : l'épargne se juge aux itérations.
- **`earlyStop` dans la cuisine** ne change ni ses résultats ni ses empreintes, puisque chaque décision y tire son hasard
  d'une graine fixée. L'allumer par défaut est à Sami.
- **Les projets n'avaient pas `npx mcts-backlog`** : leur lien date d'avant la commande, et un `npm install` le crée.

## Cuisine

```text
mcts-commun a changé ce soir (27/10, commits a9a4c99 et 4abc577 ; node_modules/mcts-commun est un lien, tu as déjà
le code). Lis ../mcts-commun/docs/recherche.md (§ 1, 2 et 5) et, dans ../mcts-commun/docs/backlog.md, « A* ou la
recherche ? » et la recommandation 8. Ne modifie pas mcts-commun : si quelque chose y manque ou semble faux, dis-le-moi.

1. Vérifie : `npm run check`. Tes empreintes ne doivent pas bouger (le correctif rend les mêmes chemins, les
   réglages sont éteints par défaut). Si l'une bouge, arrête-toi et montre-moi le diff.
2. Le gain d'A* : sur couloir et tables-detour, un service des règles et un de la recherche (search-bench), relève
   astar.ms, astar.expanded / astar.calls et astar.givenUp dans la trace, et compare aux chiffres du matin
   (docs/mesures-27-10.md : 4,6 s → 0,33 s ; 18,7 s → 8,0 s). Les mêmes plats à l'heure.
3. `diagnose(result, { depth })` (export de mcts-commun/mcts.js) : ajoute à search-bench une option qui compte les
   codes rendus à chaque décision, par cuisine, sans changer les résultats. Dis-moi quel code domine
   (fewIterations, flatScore, closeCall, shallow) : c'est le levier à travailler ensuite.
4. `earlyStop: true` : une option dans compare et tranches, éteinte par défaut. Mesure-la par paires sur les mêmes
   services contre la recherche actuelle : les plats à l'heure et les retards (avec l'intervalle), et ce qu'elle
   épargne (search.iterations, durée). Ne la mets pas par défaut : tes empreintes changeraient, c'est à moi de trancher.
5. `widening` seulement si diagnose dit souvent `shallow` (à depth 2 et width 4, il n'a presque pas de prise).
6. Les cases réservées deux fois, si ce n'est pas déjà fait : grid.overbooked contre grid.overbookedInClone dans
   les traces. Une réservation hors clone est un défaut du modèle de cuisine.

Les mesures longues vont dans la file de jour, comme la recommande ../mcts-commun/docs/backlog.md : tag
essais-commun-AAAA-MM-JJ, ids datés, tranches de 30 min au plus avec un job d'agrégat (after), progress() à chaque
service, une estimation tirée des durées d'aujourd'hui, `npx mcts-backlog --add-file`. Ne lance pas le lanceur
(je le fais), n'écris jamais dans ~/.mcts-backlog. À la fin : docs/mesures et le changelog comme d'habitude, un
commit sur main sans push, et un résumé pour moi : empreintes, gain d'A*, codes de diagnose, verdict d'earlyStop.
```

## Entrepôt

```text
mcts-commun a changé ce soir (27/10, commits a9a4c99 et 4abc577 ; node_modules/mcts-commun est un lien, tu as déjà
le code). Lis ../mcts-commun/docs/recherche.md (§ 1, 2 et 5) et, dans ../mcts-commun/docs/backlog.md, « A* ou la
recherche ? » (le tableau des plans) et la recommandation 8. Ne modifie pas mcts-commun : si quelque chose y manque
ou semble faux, dis-le-moi.

Le correctif te concerne au premier chef. Le test « cible hors d'atteinte » d'A* (1c37ffc, ce matin) grossissait de
façon exponentielle sur tes plans : 266 ms au lieu de 8 sur un coin muré de 16 × 7. Les jobs ligne-retours-001 et
-051 ont pris 38 et 39 min pour 23 annoncées.

1. Vérifie : `npm run check`. Tes empreintes ne doivent pas bouger (les mêmes chemins). Si l'une bouge, arrête-toi
   et montre-moi le diff.
2. Avant et après, à l'identique : relance une tranche courte de ligne-retours, par exemple
   `node scripts/line-compare.js --plan retours --search --from 1 --days 10 --out tmp/...`. Compare ses 10 journées
   à celles de tmp/night/ligne-retours-001.jsonl : les mêmes chiffres, hors temps. Compare aussi sa durée par journée
   à celle d'aujourd'hui (`npx mcts-backlog --status ligne-retours-001-2026-10-27 --json` : 38 min pour 50 heures).
   Relève astar.expanded / astar.calls et astar.givenUp dans la trace. Fais de même sur une mesure de journées qui
   passe par day-legs (quais ou assemblage).
3. `diagnose(result, { depth })` (export de mcts-commun/mcts.js) : une option de search-bench, de line-compare et de
   plant-compare qui compte les codes rendus à chaque décision, sans changer les résultats. Dis-moi quel code domine.
4. `earlyStop: true` : une option éteinte par défaut, mesurée par paires sur les mêmes journées contre la recherche
   actuelle (tours, bord étroit, vides, avec l'intervalle), et ce qu'elle épargne (search.iterations, durée). Ne la
   mets pas par défaut : c'est à moi de trancher, comme pour la couverture.
5. `widening` seulement si diagnose dit souvent `shallow`.
6. Une question pour plus tard, sans rien coder : tes robots se gênent-ils assez (attentes, replanifiés, cases
   réservées deux fois hors clone) pour que PIBT, la planification de toutes les unités pas à pas, vaille d'être
   essayé contre l'A* coopératif ? (recherche.md § 3 et 4)

Les mesures longues vont dans la file de jour, comme la recommande ../mcts-commun/docs/backlog.md : tag
essais-commun-AAAA-MM-JJ, ids datés, tranches de 30 min au plus avec un job d'agrégat (after), progress() à chaque
journée, une estimation tirée des durées d'aujourd'hui (corrigées si le gain se confirme), `npx mcts-backlog
--add-file`. Ne lance pas le lanceur (je le fais), n'écris jamais dans ~/.mcts-backlog. À la fin : tes docs et le
changelog comme d'habitude, un commit sur main sans push, et un résumé pour moi : empreintes, identité des
résultats, gain de temps, codes de diagnose, verdict d'earlyStop.
```

## Urgences

```text
mcts-commun a changé ce soir (27/10, commits a9a4c99 et 4abc577 ; node_modules/mcts-commun est un lien, tu as déjà
le code). Lis ../mcts-commun/docs/recherche.md (§ 1, 2 et 5) et la recommandation 8 de
../mcts-commun/docs/backlog.md. Le correctif d'A* ne te touche pas (pas de grille chez toi). Les nouveaux réglages
de la recherche, si. Ne modifie pas mcts-commun : si quelque chose y manque ou semble faux, dis-le-moi.

1. Vérifie : `npm run check`. Tes empreintes ne doivent pas bouger (les réglages sont éteints par défaut). Si l'une
   bouge, arrête-toi et montre-moi le diff.
2. `diagnose(result, { depth })` (export de mcts-commun/mcts.js) : une option de search-bench et de
   pathway-search-compare qui compte les codes rendus à chaque décision (la garde, puis chaque règle de parcours :
   lits, pauses, internes, files, alertes, SAUV, HET), sans changer les résultats. Dis-moi quel code domine où.
   flatScore ou closeCall sur une décision qui compte, c'est le score à revoir : la mesure par l'arrivée,
   l'omniscient.
3. `earlyStop: true` : une option éteinte par défaut, mesurée par paires sur les mêmes gardes contre la recherche
   actuelle (tes mesures habituelles, avec l'intervalle), et ce qu'elle épargne (search.iterations, durée). Ne la
   mets pas par défaut : c'est à moi de trancher.
4. `widening` seulement si diagnose dit souvent `shallow` (à depth 2 et width 4, il n'a presque pas de prise).
5. Lis DyRo-MCTS (2025, recherche.md § 3), une MCTS qui préfère les décisions robustes aux imprévus. Dis-moi en
   quelques lignes si son idée s'applique à ton score, sans rien coder.

Les mesures longues vont dans la file de jour, comme la recommande ../mcts-commun/docs/backlog.md : tag
essais-commun-AAAA-MM-JJ, ids datés, tranches de 30 min au plus avec un job d'agrégat (after), progress() à chaque
garde ou journée, une estimation tirée des durées d'aujourd'hui, `npx mcts-backlog --add-file`. Ne lance pas le
lanceur (je le fais), n'écris jamais dans ~/.mcts-backlog. À la fin : tes docs et le changelog comme d'habitude, un
commit sur main sans push, et un résumé pour moi : empreintes, codes de diagnose, verdict d'earlyStop, l'avis sur
DyRo-MCTS.
```

## CodinGame

Écrit avant de savoir que les bots existaient déjà, dans `E:\Dev\Algo code in game`, liés à mcts-commun, avec leur build
en un seul fichier et leur arène locale. Le soir même, ce dépôt rejoint `E:\Dev\My projects\mcts-codingame` (commit
`4c88ff6` du dépôt). Le prompt reste valable pour lui : le dépôt existe déjà, et son build et son arène répondent aux
points 3 et 4.

```text
Nouveau projet, à côté des autres dans E:\Dev\My projects : mcts-codingame. Un bot CodinGame en JavaScript, construit
sur la lib commune (`"mcts-commun": "file:../mcts-commun"`), un terrain d'entraînement pour elle (lopin,
docs/ismcts-ailleurs/feuille-de-route.md § 5). Lis d'abord :
- ../mcts-commun/README.md et ../mcts-commun/CLAUDE.md, pour les règles de la famille : Node 20, modules ES, pas de
  build, docs en français, code en anglais, hasard semé, npm run check et le budget de lint de
  ../mcts-commun/eslint.config.js, commit sur main sans push ;
- ../mcts-commun/docs/recherche.md : § 1, « Pour un bot CodinGame » ; § 3, les post-mortems ; § 4, ce qui manque.

1. Avec la compétence codingame, propose-moi deux ou trois jeux (un défi en cours, ou un jeu multijoueur de bots)
   où la recherche a sa place, et attends mon choix. Pour l'accès à l'API, c'est moi qui valide l'autorisation.
2. Une règle simple d'abord, mesurée. Puis la recherche : `search` avec `deadline` (40 ms sur 50 par tour, une
   marge pour lire et écrire ; le premier tour a plus), `diagnose` écrit sur la sortie d'erreur à chaque tour, et
   `astar` avec horizon, maxNodes et partial si le jeu a une grille. Garde le plus long tour (`ms`) de chaque partie.
3. Un seul fichier : CodinGame n'en prend qu'un. Écris dans ce dépôt un script de concaténation : le bot et les
   modules de mcts-commun qu'il importe, vers dist/bot.js. Vérifie que dist/bot.js joue sous Node exactement comme le
   code source. La trace ne doit rien charger : MCTS_TRACE n'est pas posé.
4. La mesure : un simulateur local des règles, la recherche contre la règle simple sur les mêmes graines, par
   paires, avec l'intervalle. Les séries longues vont dans la file de jour, comme la recommande
   ../mcts-commun/docs/backlog.md : tag essais-commun-AAAA-MM-JJ, tranches de 30 min au plus, progress(), `npx
   mcts-backlog --add-file`. Ne lance pas le lanceur (je le fais), n'écris jamais dans ~/.mcts-backlog.
5. Ne soumets rien dans l'arène sans mon accord. Les parties de test de la plateforme sont limitées : garde-les pour
   vérifier le temps réel par tour.
6. Ne modifie pas mcts-commun. Note dans tes docs ce qui lui manque pour ce jeu : la beam search, Smitsimax pour
   les coups simultanés, la réutilisation de l'arbre d'un tour à l'autre, la concaténation. Dis-le-moi : un ajout
   à la lib se prouve d'abord ici.

À la fin : un résumé pour moi, avec le jeu, la règle contre la recherche, le tour le plus long, les codes de
diagnose et ce qui manque à la lib.
```

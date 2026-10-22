# CLAUDE.md

Guidance for Claude Code in this repository.

## Project

The shared library of the `mcts-*` projects: search (MCTS, ISMCTS), discrete-event simulation, scheduling, grid paths, measures. It knows none of the themes: each project describes its problem (README, the `Problem` typedef).

One of Sami's `mcts-*` repositories, created 22/10/2026, siblings in `E:\Dev\My projects\`:
`mcts-commun` (the shared library), `mcts-urgences`, `mcts-entrepot`, `mcts-cuisine`, and `lopin` (the card game
where the ISMCTS was built and measured). The plan and the reasons live in lopin's
`docs/ismcts-ailleurs/` (`feuille-de-route.md` first).

## Rules

- **Prose docs are in French**, as the owner works; code, comments and identifiers are English.
- **Node 20, ES modules, no build step**: the same modules run under Node (tests, benches) and in the
  browser page. Modules that decide import no `node:*`.
- **What decides is pure and tested** (`npm test`, `node --test`); the page only draws and listens.
- **Randomness is seeded** (`createRng` of `mcts-commun`): a scenario and a search replay from their seed.
- **A simple rule first**, measured on the same scenarios; a search must beat it, paired over the same
  scenarios, with its interval. A quick screen rejects, it never promotes (lopin's lesson).
- **Markdown files stay under 800 lines**, this one under 300.
- **Commit straight to `main`**; push only when Sami asks.

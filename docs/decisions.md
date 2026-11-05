# engine: decisions

Living doc. Decisions that bind this repo, newest last. Cross-repo decisions
(J-numbers) are Jake's, from `Raynos/project-wildshard-meta` `docs/multi-repo/MULTI-REPO-PLAN.md`;
this repo's own decisions are D-numbers.

## Cross-repo (J)

- **J1**: **One `engine` repo** with `shared/`, `client/` and `server/` folders, lint that keeps client and server completely separate, and build targets that output the client and server as separate things. It replaces the earlier `mmo-server`, `mmo-client` and `protocol` repos
- **J2**: Client never imports server code and server never imports client code; both import `shared/` (as Source's `game/shared` is built into both DLLs)
- **J3**: **The shardfile is the raw format**: a tarball of JSON + assets that authors upload. The engine does not run on it. The build **cooks** it into **runtime packs**, which are GPU- and physics-ready and keyed by shardfile hash + engine build (singleplayer DOWNLOAD, `docs/plans/DOWNLOAD.md:152-158`)
- **J4**: Replication is **declared on entity state**, like Source SendTables or Unreal `Replicated` properties; snapshots and deltas are generated from it
- **J5**: The server owns the sim. The client renders, takes input, predicts its own character and interpolates everything else
- **J10**: Art splits by owner: the engine (shared client art, highway and centre) and each shard
- **J28**: The cook runs in a **separate cook worker** beside the MMO server, built from the same engine build, so the game server never cooks in-process. It cooks both client packs (written to R2) and server packs
- **J29**: After an engine release, the new build **re-cooks every live shard at deploy**, before it takes traffic
- **J31**: **Listen server.** A third, *standalone* build target runs the server build in a Web Worker and the client talks to it over an in-process loopback, as Source and Unreal do for singleplayer. The game keeps shipping through the migration with `client/` never importing `server/`

## This repo (D)

- **D25**: 2026-11-04: a commit of 30+ changed lines stages a
  `project/journal/` entry (from greenroom; `.githooks/pre-commit`).
- **D27**: 2026-11-04: main only: no branches, no worktrees, every
  agent commits on `main` by pathspec (from greenroom).
- **D28**: 2026-11-05: lint is the strictest of greenroom and
  wildshard-singleplayer (every oxlint category denied, type-aware, warnings
  denied, unused disable directives are errors, `import/no-nodejs-modules`
  outside Node-side folders). Imported code may arrive under a shrink-only
  ratchet (Jake, 2026-11-05).

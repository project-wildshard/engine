# engine: import from singleplayer

Status: draft 2026-11-05: waits on shardfile moved (P2); E1-E6 (0 untagged, 0 entangled files; standalone target live); C1-C4 (after DOWNLOAD closes).

One-page runbook for bringing this repo's code over from
`Raynos/project-wildshard-singleplayer`. The why and the full plan live in `Raynos/project-wildshard-meta`:
`docs/multi-repo/MULTI-REPO-PLAN.md`, `P1-IN-TREE.md`, `MOVES.md` (phase P3).
Live cross-repo status: `docs/multi-repo/STATE.md` there.

## What comes in

From `Raynos/project-wildshard-singleplayer@727236c625` (paths may move before the import; re-check them then):

- `src/engine/ and src/game/, re-sorted into shared/client/server/cook by the P1 E2 ownership map`
- `the headless host (src/sdk/headless.ts and the tick worker files)`
- `the cook (scripts/app-build/spawnParts.ts and the pack builder)`
- `the app shell (src/*.ts, index.html, vite.config.ts)`
- `src/commons/`
- `shared assets (public/assets/{gpu,tex,music,sfx,hdri,models,baked}) and highway/centre art`

## Before the import

- shardfile moved (P2)
- E1-E6 (0 untagged, 0 entangled files; standalone target live)
- C1-C4 (after DOWNLOAD closes)

## Steps (MOVES.md, the standard move)

| # | Step | Done when |
|---|---|---|
| 1 | Freeze: tell the singleplayer lanes, pause commits to the moving paths, record the SHA | The SHA is in this plan |
| 2 | Import commit: copy the paths at that SHA into this repo; the message names the SHA and paths (J12) | One commit, nothing else in it |
| 3 | Binaries over 1 MB go to R2 by hash (J13) | The pre-commit size cap passes without `ALLOW_BIG` |
| 4 | Green: `pnpm check` and CI pass; imported code that fails the strict lint goes under a shrink-only ratchet (D28) | CI green on `main` |
| 5 | Release `v0.1.0` with built `dist/` on a tag-only commit (J23) | The tag installs as a git dependency |
| 6 | Switch: singleplayer uses this repo (git dependency or deploy) instead of its own copy | Singleplayer CI green |
| 7 | Delete the paths from singleplayer in one commit naming this repo and tag | Gone from singleplayer |
| 8 | Unfreeze; record the move in the meta repo's `STATE.md`; set this plan to finished | STATE.md says moved |

Rollback: until step 7 singleplayer still has everything, so drop the import commit.

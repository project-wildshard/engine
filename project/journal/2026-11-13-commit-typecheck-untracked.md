# Commit typecheck skips other lanes' untracked files (opus-quickfix, HOW-WE-BUILD WL20)

> Written by: Claude (opus-quickfix), 2026-11-13

The commit lane ran the whole `pnpm typecheck` over the working tree, so one lane's untracked scratch (a broken
`scripts/*.mjs`, a half-written test) blocked every other lane's commit. Three lanes were blocked on 2026-11-13.

- `.githooks/commit-typecheck.mjs`: with no untracked file in any tsconfig it runs `pnpm typecheck` as before.
  Otherwise each `tsc -p|-b <config>` in the script runs on an overlay in `.tsc-layers/commit/` that extends the real
  config and lists its files minus the untracked ones. The overlays keep the real `outDir` and `tsBuildInfoFile`, so
  the incremental build stays warm (3 s warm on this checkout).
- Tracked and staged files are still checked; tracked code importing an untracked file fails in a composite project.
- `.githooks/commit-typecheck.test.mjs`: a broken untracked file passes, the same file staged fails, and a tracked
  error still fails beside untracked files.

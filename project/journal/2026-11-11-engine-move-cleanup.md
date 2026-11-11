# Engine-move cleanup: the six lines that still ran (PG1)

Meta ENGINE-MOVE-CLEANUP-PLAN row PG1 (J254). P3 lifted sharddev out,
but six engine lines still pointed into `src/sharddev` or `src/game`.

- `map-hash` and `memory-report` found `sharp` by walking up from a
  folder that is gone; it resolved through engine's devDependency or
  pnpm's hoist. Both now resolve from the script itself, and engine
  declares `sharp` as an optional peer, so a consumer's `sharp` is
  linked beside its install of engine.
- `map-painter.d.mts` imported `MapRaster` from a gone file, so it was
  silently `any`. It now declares `MapPaintRaster`, the three fields
  `stylizeMap` reads; sharddev's `MapRaster` satisfies it (checked with
  tsc and a `@ts-expect-error` on a raster with no heights).
- deploy.yml's Basis compiler cache keyed on two gone files, so the key
  never changed. Nothing in engine builds the Basis tool any more (its
  preparer refuses until P4), so both steps are gone. The wiring test
  became a guard: every committed source a workflow hashes must exist.
- `game-plugins.mjs` read `src/game/package.json` and nothing called it:
  deleted, with its five allow-list rows.

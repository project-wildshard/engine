# CI21's overdue batches (buddy-engine, J237)

The seven codex-mock batches whose J237 window closed 2026-11-14T18:00Z
still listed 23 files in `test/lift-pending.json`, so `readLiftPending`
threw `CI21 batch deadline missed` and every engine pre-push (and every
Vitest run) was red. Batch membership is immutable; a batch empties when
its files leave the lift-pending list, ported or retired with a J186
reason recorded in `test/engine-lift-disposition.json`.

- SF-BAKE: `glb-normalized-positions` was already ported to shard-format
  (`src/format/glb-normalized-positions.test.ts`); engine's copy, which
  read a Driftwood GLB engine no longer has, is deleted (`migrated`).
- DRIFT-NAMED: `graph-scene-author-ports` was ported to shard-driftwood
  (`test/driftwood-graph-scene-declarations.test.ts`); engine's copy and
  its fixture `graph-scene-author-observation.ts` are deleted.
- PLOTS-TOOL: `open-plots-capture` and `open-plots-config` were ported to
  shard-open-plots (same names); engine's copies imported modules that
  left engine and are deleted.

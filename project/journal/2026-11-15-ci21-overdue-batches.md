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
- NAL-TOOL: `nalati-author-tools` hashed the bake scripts against their
  bytes at a monorepo relocation; the scripts left for shard-nalati.
  Retired (J186) with its two fixtures; no port claimed.
- DUNES-TOOL: `sunscar-generation-inputs` drove engine's retired
  monorepo generation pipeline against a Sunscar source engine no longer
  has. Retired (J186); no port claimed.
- E-PRODUCT: `build-validation-receipts` is engine's app-build check and
  runs again in place, 14 of 14 green and typechecked again. Its one
  "SDK publisher" test imported sharddev's `writeOutputProduct` (that
  folder left engine) and is dropped; that half is sharddev's.
- E-LAYOUT: the twelve files that still exist run again in place
  (102 tests green, typechecked; six left the tsconfig excludes). 29
  cases are retired (J186), each named with its reason in the
  disposition: their fixtures build or plan the pre-lift layout
  (`src/client/app/entry.ts`, `src/engine/...`, `src/shards/...`), and
  14 of them are sort-sides' one-time P1 side sort. `entry-totals` kept
  its case and only dropped Pine's own `packs-set.json` read.
  `closed-components`, `platform-namespace-reach`,
  `platform-pending-users` and `shard-component-crumbs` were already
  deleted with the old census (HR9) and unlisted.
- Every Vitest run failed at config load while a batch was overdue,
  which is why no single test could be run without unlisting first.

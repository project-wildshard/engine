# Lift originals no test reads (ZONE-SNAPSHOTS ZS10, first part)

> Written by: Claude (lane opus-snap). 2026-11-24.

J507: no old zone snapshots in tests. These 38 lift originals, legacy oracles and approved pin records had no
reader left in `test/`, `src/` or `scripts/` (their ports finished; only the CI21 records `engine-lift-disposition.json`
and `ci21-sdk-tail-held.json` still name them, as history). Deleted by hand; git history keeps the bytes:

- `test/fixtures/channel-quest-author-original.json`
- `test/fixtures/driftwood-page-admission-original.json`
- `test/fixtures/driftwood-rock-author-original.json`
- `test/fixtures/driftwood-trail-models-original.json`
- `test/fixtures/geometry-cache-author-original.json`
- `test/fixtures/graph-scene-author-original.json`
- `test/fixtures/held-slot-author-original.json`
- `test/fixtures/hibiscusFiles-original.json`
- `test/fixtures/legacy-oracles/movers/1371d8959aebb567404fc8db59592b0d63f7afeb7060f0b74ea4f12389e6bafd`
- `test/fixtures/legacy-oracles/movers/9a5171bc3dd84488aae9de29ebd07fdb12dfbd2500c45cf91cf37e5bbbc712f0`
- `test/fixtures/legacy-oracles/nalati-ambience.d.json.ts`
- `test/fixtures/legacy-oracles/nalati-ambience.json`
- `test/fixtures/legacy-oracles/nine-light.json`
- `test/fixtures/legacy-oracles/pine-hollow-log.json`
- `test/fixtures/manual-coat-bow-original.json`
- `test/fixtures/nalati-ambient-original.json`
- `test/fixtures/nalati-balbal-original-0.bin`
- `test/fixtures/nalati-balbal-original-1.bin`
- `test/fixtures/nalati-finds-original.json`
- `test/fixtures/nalati-floor-original-0.bin`
- `test/fixtures/nalati-floor-original-1.bin`
- `test/fixtures/nalati-headless-original.json`
- `test/fixtures/nalati-script-sections-original.json`
- `test/fixtures/nalati-sky-author-original.json`
- `test/fixtures/nalati-taming-poses-original.json`
- `test/fixtures/palmFiles-original.json`
- `test/fixtures/quest-placement-author-original.json`
- `test/fixtures/quest-prop-author-original.json`
- `test/fixtures/scene-source-author-original.json`
- `test/fixtures/species-barrel-author-original.json`
- `test/fixtures/spruce-author-original.json`
- `test/fixtures/typed-look-authors-original.json`
- `test/fixtures/view-author-original.json`
- `test/fixtures/approved-enemy-placement.json`
- `test/fixtures/approved-population-metadata.json`
- `test/fixtures/approved-population-returns.json`
- `test/fixtures/approved-quest-families.json`
- `test/fixtures/approved-sheep-root.json`

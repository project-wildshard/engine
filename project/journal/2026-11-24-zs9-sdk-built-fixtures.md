# SDK-built fixtures leave frozen/ (ZONE-SNAPSHOTS ZS9, first half)

> Written by: Claude (lane opus-snap). 2026-11-24.

J507's audit of `test/fixtures/frozen/` sorts each file into live-pin data, engine-shaped or dead. The first sort is the
engine-shaped half: `script-guests/` with `scriptGuests.ts` (guest modules the SDK compiler built from made-up sources
in the tests, keyed by their source; J342 keeps compilers out of engine CI) and `glb/` with `glb.ts` (GLBs the SDK's
`staticGlb` baked from made-up primitives, keyed by their input). Neither holds a zone, so both move to
`test/fixtures/sdk-built/` unchanged, and the guard's baseline drops their 112 entries. The zone extracts left in
`frozen/` (Nalati, Nine, Pine, Dunes, Driftwood rows) are the second half.

## Second step

Six more SDK outputs of made-up inputs move to `test/fixtures/sdk-built/` with their pins and export recipes, under their
own loader (`sdk-built/snapshots.ts`, `sdkBuiltJson`): the two cosmetic client channels, the decision worker product,
the return group, the scene-graph page and the boar query (engine's own BOAR baked by the SDK). `workerFolder.ts`
follows its JSON. `arena-page.json` is a made-up orchard page, so it leaves `frozen/` for `test/fixtures/`.

## Third step

`held-arms-platform` reads the arms rigs Driftwood's and Nine Dragon's live pins mount (byte-identical); the frozen
`driftwood-arms.glb` and `nine-arms.glb` copies and their manifest rows go.

## Fourth step (lane opus-snap2)

The 24 GLB and KTX2 files in `frozen/assets` that the SDK baked from made-up recipes (`staticGlb`,
`bakeRawColourPixels`: hero, hull, the specimens, scene, the twelve whole-library parts, the product crates and the raw
KTX2 pair) move to `test/fixtures/sdk-built/assets/` with their pins and recipes, under `sdk-built/assets.ts`
(`sdkBuiltAsset`). `frozen/assets` keeps only its four Nalati extracts (bodies, balbal cracks, kokpar, the carried
prop), which the zone half of the audit handles.

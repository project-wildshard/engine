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

## Fifth step: the species world reads Nalati's live pin

`test/fixtures/livePin.ts` reads a live pin's files by logical name (`liveBytes`, `liveJson`, `liveSection`) from the
product `pnpm pins` installed. The species world (`liveSpeciesWorld.ts`), the admitted sheep and the species catalogue
entry test now build from Nalati r8's `actors/sheep.json`, `actors/species-looks.json`, `actors/bodies.bin` and
`actors/sheep.bin`, as the client's species.program does. The frozen species view, crowd view, sheep body and the
r4-era packed bodies and balbal cracks go.

## Sixth step: Kokpar and the dressing read the live pin

The carried-quest host and the Kokpar rider oval read Nalati r8's `quests/carried.json`, its quest prop and its decision
guest (`liveCarriedQuest.ts`, by the script row's own blob path); the oval's centre, radii and turn are written in the
fixture by hand as the independent oracle. Schema-code-memory and the riders read the live `world/dressing-phone.json`.
`frozen/assets` is empty and goes, with the dead `carriedPropFiles.ts` (it read a file deleted in ZS10).

## Seventh step: Nalati's guests and population rows read the live pin

`liveNalati.ts` takes over from the frozen `runtimePrograms.ts`, `runtimeBehavior.ts`, `titan.ts` and the admission half
of `nalati.ts`: admission, riding, titan, pasture, held (the spear's polearm guest), wildlife, stealth and the night
encounter all come from Nalati r8 through `engine-lift/pins.ts`, and every guest is lent from the pin's own return
scripts. 40 test files moved with no assertion changed. One went: `taming-guest-legacy`'s historical-wire replay
compared the live v2 riding guest with the ABI1 witness through the finished port's oracle, and the live guest now
reports its own cue (-1 at rest) where the witness still says 0, so that oracle proves nothing players run.
`nativeRoster.ts` and `stealthRows.ts` were engine-shaped and leave `frozen/`.

## Eighth step: strikes, the Golden King, the night and the weather

Every creature strike profile the CI21 extract named is in Nalati r8's live files (wildlife contacts, the balbal guest,
the night's contact, the elite constructs' plan rows, the titan fight's cuts, hazards and arena contacts), so
`liveStrikeProfiles` reads them there; the Golden King, the elite kernels, the balbal guest and projection, the night
encounter's parameters and the weather reactions and guest follow. The charge spawn script reads engine-lift's live
`charge`. `livePath` finds a script row's module by its hash (a witness ships under `blobs/bin`). The frozen loader's
own self-test and the dead `titanFightOwners.ts` go.

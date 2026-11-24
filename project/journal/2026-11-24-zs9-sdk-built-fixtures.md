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

## Ninth step: render rows and geography

The mounted figure, the painted shape book and its fourteen shapes, and the grass field with its twelve blocks are all
files in Nalati r8 (`riding/mounted-figure.json`, `models/shape-book.json`, `models/shapes/paint-*.bin`,
`look/post.json`, `look/grass/*.bin`), so `liveRenderRows.ts` reads them there. The geography extract was author-side
(`boot/geography.generated.json`), but every block it bundled ships byte-identical as `data/geography-*.bin`, its ground,
pigment, surface and map palette are the product's discovery rows, and its population field is `world/meadow.json`:
`liveGeography.ts` reads those and writes only the map channels' lattice rows by hand. `frozen/nalati/` and its loader
are gone.

## Tenth step: contracts, returns, the perch and the boar world

The contract tests read Pine r16's live `quests/contracts.json` with its guest inline (`liveContracts.ts`). Driftwood's
return program reads its live `sim/returns.json`; the marsh and saltmarsh guests were the SDK's compiles of made-up
sources on Driftwood's return contract, so they move to `sdk-built/` (`returnPrograms.ts`). The perch fixture's monkey
policy and volley pool are Driftwood's live `poses/monkey.json` and `sim/enemy-placement.json`. The boar world is the
engine's own kit boar: Pine's live roster declares its species and ships no hull book, so the frozen Pine boar, elk,
looks and clips it laid on top go (animal-model-preparation's retirement case asks for the kit bear instead of the
frozen elk).

Still on `pine-creature-world.json`: species-health-fallback. On Pine r16's declared rows the page computes Old
Ironhide at 75 health where the native server spawns it at 300, so moving that test to the live rows turns it red on a
real page/server gap; it waits on that fix.

## Eleventh step: the last extracts, and `test/fixtures/frozen/` is gone

- The pickup bake witness reads its two tables live: Driftwood r12's `quests/interaction-source.json` interact constants and
  Pine r16's `quests/runtime.json` table, both byte-identical to the extract; the committed catalogue bytes still match.
- sword-profile-key-order reads Driftwood r12's live `combat/items` (its wood and iron melee weapons, damage 12 and 28).
- The dormant herd's wolf pack is Nalati r8's live `actors/wildlife.json` group (the extract minus home and members, which
  the fixture names itself).
- layer-hunt-targets reads Pine r16's declared boar and elk rows; their tuning now carries `motion` beside the hunt
  numbers, split off as `declaredNative.ts` does.
- species-health-fallback reads Pine r16's declared species. Correction to the tenth step: the Old Ironhide "gap" was
  not one. It is an elite-ranked spawn (`creature:164`), and the server multiplies its 75 by the rank's health (300),
  `declaredRanks.ts`; the test now applies the rank. Pine r16 also authors its deer health, so the no-health premise
  lives in the unit test above it.
- held-slot-entered and `nineHeldEntry.ts` are deleted: they proved a starter blade plus a grapple tool in held claims
  on Nine r3's runtime and item rows. Nine r5 moved its Jian to a kit.melee row and its grapple to a `state/modes` row,
  and no live pin declares a tool item with held claims, so the test proved nothing a player loads (J507).

The guard's only offender left is Brasscap's corpus, which ZS10 re-exports.

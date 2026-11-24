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

## Second part

- `test/fixtures/grazer-herd-original.ts`, the pre-port grazer brain: `grazer-frame-input` keeps its bad-clock and
  mismatch guards on today's brain; the two cases that compared frame by frame with the old brain go (the port is done).
- `legacy-oracles/nalati-runtime-debt.json` with `runtime-performance-rekey`'s historical Nalati case (its
  `nalati-grasslands-legacy` source is long gone); the rekey cases stay.
- `approved-population-families.json` (+ `.d.json.ts`): `wildlife-schema-metadata` reads `actors/wildlife.json` from
  Nalati's live pin.
- `legacy-oracles/nalati-audio.json` and the last mover oracle (`canoe.json` names its hash as a module id only): no reader.

## Third part

- `test/fixtures/host-ruler/{pine-hollow,native-pine-hollow,native-driftwood-isle}` (trimmed shard.json copies of Pine
  Hollow 3cdd93f and Driftwood): `host-ruler-roots`, `host-ruler`, `host-ruler-server-roots` and `host-primitives` read
  the two live pins instead; the counts of the old revisions (14 kinds, 58 sections, 17 and 14 hosts) become shape checks,
  and Driftwood's live hosts now join collision, plumbing and quest only.

## Fourth part, and a correction

- Correction: the first part's `nalati-balbal-original-{0,1}.bin` were not unread; `specimen-selection` read them by a
  computed name. It now reads `models/specimens/balbal-{0,1}.bin` from Nalati's live pin (byte-identical).
- `nalati-audio-original.json`: the two audio phrase replays read the live `audio/audio` section, whose synth rows equal it.
- `legacy-oracles/pine-weather.json`: `weather-legacy.proof.mjs` drops its 2400-output oracle of pine-hollow-legacy's
  weather (a finished port); its old v1 saves still resume on the live Pine pin.
- `nalati-balbal-original.json`: `encounter-sites` and `specimen-selection` use a made-up stele (engine-shaped rows) whose carved variants are the live pin's two blocks.

## Fifth part: the r3 Dunes keeper

`dunes-r3-keeper.{json,ts}` grafted Sunscar r3's keeper population (ray and strider homes, the Matriarch keeper) onto
today's Dunes pin. No live pin has a population home any more (Dunes and Far Reach list none), so the cases that needed
that graft go with it: `runtime-declared-creatures.test.ts` (all three), `matriarch-borrowed-body.test.ts`, and
`headless-population`'s herdless page case. The keeper-home path now has no zone and no test: a FORMAT-PRUNE candidate.

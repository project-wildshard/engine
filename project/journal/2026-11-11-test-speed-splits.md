# TEST-SPEED TS5: no blocking file over 30 s hosted

> Written by: Claude (opus-testspeed-lane)

Jake's J255 grill: a file over 30 s hosted is split or rewritten with the
same facts; 60 s stays the hard cap. The 30 s line is what lets TS2 run
two shards at a time in a packed job: the CP2 spike (run 42955579476)
slowed files 1.15-1.3x at the median and up to 2.4x, so only files that
take 30 s alone stay under 60 s.

Fourteen green packed runs (42960840275 .. 42966511029) had 16 blocking
files over 30 s at their worst. This first batch is the mechanical one:
files whose cases already own their residents, split by case with every
body unchanged.

| File (hosted max, 14 runs) | Now | Cases |
|---|---|---|
| physics-open-plots-headless (49.3 s) | plots 1-6 stay; 7-12 -> `-2`; 13-17 -> `-3` (plot lists in `test/fixtures/openPlotGroups.ts`; a new plot lands in the original file) | 19 = 6 + 7 + 6 |
| physics-shards-headless (44.8 s) | Pine, Nine, Sunscar, Far Reach stay; Blender Template -> `physics-blender-template-headless` | 55 = 43 + 12 |
| native-runtime-observation (36.3 s) | Far Reach stays; Sunscar -> `-sunscar` (body moved verbatim to `test/fixtures/nativeRuntimeObservation.ts`) | 2 = 1 + 1 |

Each describe still opens one resident per shard or plot, and every leg
runs in the same order on it, so no case changes what it proves. Local
clocks (Mac, alone): open plots 5.0 / 4.5 / 3.9 s, shards 6.5 s,
Blender 5.1 s, observation 7.5 / 7.9 s.

Registries follow the split: the new files are their own native units
in `scripts/vitest-ci-files.ts`, their products are in
`scripts/test-products.json`, they are Ring 2 in
`test/pins/ring-2-tests.json`, `scripts/physics-native.mjs` picks the
right module per slug, and deploy's native-routes step runs the two new
route files.

The four new files' first clocks come from the push gate's timing
reporter (`push-preflight.mjs timings`); the parents keep their old,
larger weights until hosted runs re-time them, so the planner errs long.

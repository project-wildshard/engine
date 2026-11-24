# FP53a: the island population goes

> Written by: Claude (opus-prune2). 2026-11-24.

FP20 (`b75b5f57d`) refuses `population.mixed`, so nothing could install Driftwood's old island roster any more. What
ran only on it goes with it:

- `src/server/game/population/mixedRoster.ts` (the roster, its Captain slot, returns and poses);
- `src/server/game/boss/nativeWake.ts` (the wake shell that spawned the Captain);
- the `population.reactions`, `population.settle` and `population.poses` hosts, now refused like `population.mixed`;
- the quest composition's `island` port: the acquisition guard and the kill steps read only the declared bodies.

A chapter wake must name a declared fight (OF22c1); Driftwood has done so since r12 (FP16b).

The home keeper (`homeKeeper.ts`, `installHomeKeeper`) stays. `prepareRuntimeWorld` installs it for every runtime world
through `prepareNativePopulation`, even with no homes, for the declared bodies' floor and death plane. Removing it is
FP53b: it moves those to the declared host and re-records each zone's checkpoints.

# Plan proofs on planless pins

> Written by: Claude (opus-road)

- 11:25 UTC: Pine r15 (SDK 0.4.30, FP16c) ships no native plan file, and eight plan-move proofs read the pinned plan
  file, so the pin's land went red. `src/test/game/shippedPlan.ts` reads a pin's plan the way `writtenPlan` builds it
  (`server/world`, no rows). A planless pin is checked as shipped: it names no host, stands from its sections, and runs
  and restores tick for tick. Driftwood and Nalati follow when they re-pin; FP21 deletes these proofs with the plan file.
- 11:50 UTC: main went red on `test/roster-owners.proof.ts` (Pine r15 has no plan file), one the 8 missed. Every test that
  reads `server/native-assembly.json` from a pin now goes through `shippedPlan.ts`: `standingHosts` (engine) for the hosts,
  `foldedPlan` to cut or add rows (guarded: a folded product runs as shipped), so the Driftwood and Nalati re-pins pass.
- 12:40 UTC: Driftwood r12's shard-pin went red: its `server/quest` chapter row names no `population` (its wake is a declared fight, OF22c1), and the host passed `population: undefined`, which is not JSON. The chapter wake's population is optional where a declared fight wakes; a wake with neither refuses.
- 12:20 UTC (opus-road): FP21 rebased onto main with Pine r15 and Nalati r8 (planless). `standingHosts` reads `writtenWorld`; a test plan file hides `server/world` and the family sections (never both); the riding refusal reads FP21's "not both".
- 13:05 UTC: shard-pin gains a macos-15 `darwin-digest` job. Every Ring 1 pin (Driftwood r8, Pine r10, Sky Reach r7, Driftwood r12) needed a hand-recorded darwin-arm64 Ring 1 digest before the MacBook push gate would land it; the job records it onto the pin branch.

- 13:55 UTC (opus-road): main red 45404606407: open-plot-thin-ice and open-plot-desert-ruin were pinned with no copy on the pins mirror, the API blipped, and `pins.ts install` had no source. Backfilled both; `pins-mirror.yml` now uploads any pin missing from the mirror on every pin move (and every 6 hours) and fails if one is still missing; `pins.ts` tries the API three times with backoff.
- 13:25 UTC (opus-road, FORMAT-PRUNE FP41b): engine's `public/assets/models/pine-hollow-trees` (12 files) goes with its boot-publication rows (and the gpu twins' rows), the C0d debt line, the shard-words pin and the gitignore line. Lands with the Pine revision that mounts them (shard-pine-hollow `3b83f75c`). `test/shards/pine-hollow/boot-before.json` is a lift-era record no test reads; left as is.

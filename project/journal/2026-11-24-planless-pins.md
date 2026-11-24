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
- 13:05 UTC: shard-pin gains a macos-15 `darwin-digest` job. Every Ring 1 pin (Driftwood r8, Pine r10, Sky Reach r7, Driftwood r12) needed a hand-recorded darwin-arm64 Ring 1 digest before the MacBook push gate would land it; the job records it onto the pin branch.

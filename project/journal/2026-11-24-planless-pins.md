# Plan proofs on planless pins

> Written by: Claude (opus-road)

- 11:25 UTC: Pine r15 (SDK 0.4.30, FP16c) ships no native plan file, and eight plan-move proofs read the pinned plan
  file, so the pin's land went red. `src/test/game/shippedPlan.ts` reads a pin's plan the way `writtenPlan` builds it
  (`server/world`, no rows). A planless pin is checked as shipped: it names no host, stands from its sections, and runs
  and restores tick for tick. Driftwood and Nalati follow when they re-pin; FP21 deletes these proofs with the plan file.

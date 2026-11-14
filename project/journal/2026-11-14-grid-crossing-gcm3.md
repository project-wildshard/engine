# Grid crossing, opus-gcm3 (2026-11-13 evening Cancún)

- GC5, the pre-warm: GC3's tour showed boosts held 4 to 7.6 s at the neighbour's loading wall while walks crossed clean. The road
  between cells is 50 m: under 3 s at 18 m/s, 12 s at a walk, and the world was built only once the traveller stood on it. Now,
  inside the source and heading into a neighbour's mouth, `LiveGridHost` starts that world when the traveller is its last measured
  build time away at the current speed (x1.25, floor 2 s, cap 10 s, 6 s before anything is measured; lead capped at 200 m and the
  world kept within 240 m). Only when both source and product are isolated (opaque runtimes stay exclusive) and both fit
  (`canPrepareAlongside`, G723); otherwise the road builds it as before. `test/grid-prewarm.test.ts`, red first on the boost case.
- GC8 / GC6 harness: the tour now records, per crossing, the target's `wildshard.prepare:<slug>:*` spans since the last crossing,
  long tasks (Chromium) and its shardfile bytes, plus whether the target's world stood built before the border (`builtBeforeBorderMs`)
  and whether it was pre-warmed. `scripts/grid-crossing-stages.mjs` turns tours into STAGES.md's tables. First read, loopback
  Chromium: Driftwood to Nalati's world was built 0.65 s before the border yet the walker held 7.1 s at the wall, so the hold
  is the entry (hooks, warm-up), not the world build.

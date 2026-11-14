# Grid crossing, opus-gcm3 (2026-11-13 evening Cancún)

- GC5, the pre-warm: GC3's tour showed boosts held 4 to 7.6 s at the neighbour's loading wall while walks crossed clean. The road
  between cells is 50 m: under 3 s at 18 m/s, 12 s at a walk, and the world was built only once the traveller stood on it. Now,
  inside the source and heading into a neighbour's mouth, `LiveGridHost` starts that world when the traveller is its last measured
  build time away at the current speed (x1.25, floor 2 s, cap 10 s, 6 s before anything is measured; lead capped at 200 m and the
  world kept within 240 m). Only when both source and product are isolated (opaque runtimes stay exclusive) and both fit
  (`canPrepareAlongside`, G723); otherwise the road builds it as before. `test/grid-prewarm.test.ts`, red first on the boost case.

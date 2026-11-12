# 2026-11-12 remote players (REMOTE-PLAYERS RP1, J296)

- Jake, 17:43 Cancún, after a staging v0.1.13 playtest with Jimmy: no health bar on the bear on his page while Jimmy hit
  it. Online creatures are row-driven and nothing set `lastHitT`, so `Combat.ts` drew a bar only under the page's own
  crosshair. `AnimalView.showRow` now treats a fall in the row's hp as a hit (first row excepted: a body that comes into
  view already hurt shows no bar). `row-hit-bar.test.ts`; `scripts/remote-bar-proof.mjs` (two phones, one local room)
  fails on a build without the fix and passes with it.
- The rest of what Jake asked (body, gait, held item, attacks, hoverboard, minimap markers and more) is rows RP2 to RP13 in
  meta `docs/plans/REMOTE-PLAYERS-PLAN.md`.

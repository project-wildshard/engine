# 2026-11-17 · The main screen (MAIN-SCREEN, J399)

> Written by: Claude (lane opus-mainscreen)

- MS1: ENTER THE MMO is the grid's entry for every player, and SHARD SELECT is ZONE SELECT (J387: "Not shard select, zone
  select"). The Infinite Wildshard card and its EXPERIMENTAL tag are gone. `.ws-main-grid` stays on ENTER THE MMO because
  about 30 proof scripts click it.
- MS2: board B, full bleed. On a phone the square hero is drawn the screen's width (`100% auto`), never cover-cropped,
  so the whole 5 × 5 shows with Nalati's row (Jake: "we zoomed in way too much on the hero art"). It sits above the buttons,
  runs 56 px under ENTER THE MMO and fades to navy; above it the sky carries on in the shot's own edge and middle colours,
  with a masked band over the seam. ENTER THE MMO is the filled ice-cyan button, ZONE SELECT the outlined one. CHECK
  CONNECTION left the main screen: Settings ▸ System already has the Connection doctor row.
- MS3: zone, not shard, on every menu screen. The deck's button and the deep link's read ENTER ZONE (J399); the deep link is
  the one-zone select (ZONE SELECT, one card, one thumbnail, "Loads <zone>"); "Enter through zone select"; the grid's crash
  note says "The MMO ended unexpectedly last time." `zone-words.test.ts` greps the menu words for "shard".

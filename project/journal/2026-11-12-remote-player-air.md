# The remote player's jump and fall (REMOTE-PLAYERS RP9)

- Jake, 17:43: "everything, right? Like, it's an MMO". Another player's jump showed as the standing or striding body sliding up
  and down with its row: no tuck, no arms, no landing.
- `net/remoteAir.ts` layers over the gait (`remoteGait.ts`) and under a strike (`remoteStrike.ts`): from RP6's row `air` bit
  and the row's vertical speed, the legs tuck going up, the arms go out and the legs reach coming down (blended by the speed,
  so the top of a jump turns over smoothly), and when `air` goes false the hips dip into a squat, as deep and as long as the
  last downward speed asks (`LAND_TIME`, a jump's landing about a third of a second). The air pose eases in and out. No `air`
  value is no data: nothing drawn. A board rider or a mounted one is RP8's and left alone. Under 1.5 m/s or 0.1 s off the
  ground (a slope, a step) a landing is a step, with no dip.
- `__onlinePlayers()` reports each body's `air`: `jump`, `fall`, `land` or ''.
- Test `net/remote-air.test.ts` (red first on a stub): rising versus falling, stepping off a ledge reads fall, the dip's depth
  and length, missing `air`, riders, the blend, the flicker. Proof `scripts/remote-air-proof.mjs`: two pages, Jimmy steps off
  the pier's side while Jake watches from the deck (`fall`, `land`), then jumps twice on the sand in front of him (`jump`,
  `fall`, `land`); Jake's page holds its frame on each pose for the capture and reads the bones; captures `rp9-*.png`.

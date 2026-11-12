# Other players on the minimap (REMOTE-PLAYERS RP3)

- Jake, 17:46: "we should show other players in the minimap." Every other live player within the minimap's 110 m draws
  as a magenta teardrop nosed the way they face: not the white own arrow, a creature's yellow or red dot, or a mark's
  diamond. Cyan was tried first and sank into the revealed sea around the Driftwood pier.
- The bodies live in the online bundle and the minimap in the game's, so `net/othersOnMap.ts` keeps them on `globalThis`
  (as `voiceNear.ts` does); one line in `OtherPlayers.frame()` fills it, and the minimap's paint digest includes it.
- Staleness is counted in minimap reads (30), not time: the two bundles keep two clocks, and lint bars `performance.now`.
- A closed tab's body stands 30 s (J114, `HOLD_MS`) and the marker is the body's. `scripts/remote-map-proof.mjs` runs
  the rig with `HOLD_MS=1000`, so "gone within 2 s" times the map, not J114.

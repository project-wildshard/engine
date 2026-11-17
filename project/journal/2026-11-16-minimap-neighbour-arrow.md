# The minimap's neighbour name points at its cell (SB33, buddy-engine)

- opus-pineload, noted in SB32b: Pine Hollow's minimap read "DRIFTWOOD
  ISLE", on v0.1.31 and on main.
- It isn't a title. On the live grid Pine (0,1) sits directly north of
  Driftwood (0,0), and you spawn 5 m inside Pine's south edge. The
  minimap draws a neighbour's name on its own ground across the road
  (`minimapBlend.ts`, template-prompts E435). E435 already narrowed it
  to "only while its spot is inside the disc" for this exact confusion
  in Sky Reach. At Pine's spawn the spot is inside the disc, centred
  under the arrow, so it still read like a caption.
- The coordinator chose to keep the label and mark it as across the
  road. A neighbour label now has `toward`, and the disc leads it with
  an arrow pointing out at its cell: down below the arrow, up above it,
  and up along a side rim, where the text turns so its top faces out.
  Places of the map itself are unchanged.
- Tests: `minimapNeighbourLabel.test.ts` puts the feet at Pine's real
  spawn edge on the live grid and checks the glyph per placement. Both
  were red first. A local build's Pine journey (Chromium 402x874) shows
  "▼ DRIFTWOOD ISLE" under the road.

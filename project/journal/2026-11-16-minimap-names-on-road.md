# Shard names on the minimap belong to the road (SB32c, buddy-engine)

- Follows `da38fd75`, which put an arrow on the neighbour's name. Jake
  then picked option 3 on the SB32c board: no neighbour name inside a
  cell, and names only while the player stands on the road between
  cells. opus-minimapboard checked that the road showed no name at all.
- Both halves. Inside a cell `minimapOverlay` draws no shard name, so
  Pine's spawn no longer shows "DRIFTWOOD ISLE" under the arrow. On the
  road, `roadNames` names every cell whose spot is inside the disc:
  12 m inside that cell's edge beside the feet, with the arrow toward
  it. At a crossroads that can be four names.
- Tests (`minimapNeighbourLabel.test.ts`, on the live grid): inside
  Pine 5 m from the road gives no name; on the road between Pine and
  Driftwood both name themselves on their own ground; far down a road,
  none. Both were red first. A local build's Pine journey (Chromium
  402x874) shows the disc with no name.

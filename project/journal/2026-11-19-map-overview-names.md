# 2026-11-19: the Bag map's overview names every zone, not every place

Lane: buddy-engine (MAP-NEXT MN9 and MN13, after row 58's A-1.4 sheet).

At 0.25× the map already drew all 49 cells (the placed zones' atlas tiles, the empty cells as darker squares, the roads),
but it named only three zones. Each name lived in the strip by its cell's north edge, 160 m tall, which is about 16 pt at
0.25×, and only a short name fit at the 8 px floor. Meanwhile Driftwood's nine place rings, the quest diamond, THE PIER,
CASTAWAY and the PLACES plate piled up in one 55 pt cell.

- **MN9.** A grid name now carries a `fill` box, its whole cell and roads. When the strip can't hold the name, it fills
  the cell, down to 7 px (OBSERVATORY and GRASSLANDS are single words wider than the cell at 8). All 36 placed zones
  read at 0.25×. The overview stops (0.5×, 0.25×) use the short name, CORAL DRIFT and not OPEN PLOT · CORAL DRIFT.
- **MN13.** `namesPlaces` in mapView.ts: on the grid, places are named at 1× and 2× only. Below the midpoint of 0.5× and
  1× every place is a 2.5 px dot (an unfound one a ring with no "?") and a quest marker a small diamond, with no labels.
  The arrow keeps its size at every stop. The PLACES plate moves to the frame's corner when the zone is under twice its
  width, so at 0.5× it no longer sits on your arrow, and at 0.25× not on your zone's name.

Proof: WebKit 402 x 874, all four stops from Driftwood and from a corner cell,
~/.cache/wildshard/plan-artifacts/map-next/mn9-13-*.png. The plan asked for `project/evidence/map-next/` in this repo.
Engine has no tracked evidence folder, and starting one full of PNGs isn't this row's call, so the shots sit with every
other row's evidence.

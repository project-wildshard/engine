# The client's 7 × 7, the void floor, and no card (SA34)

> Written by: Claude (opus-sa34), 2026-11-13

Jake (J314): "fuck it 7x7 grid, the outer ring beyond 5x5 is the empty void". Grill Q9: an empty cell is a walkable void
floor (flat dark plane with fog), not a wall. Q12: an auto-placed shard gets no Shard Select card; you cross in from a
neighbour.

**What changed.**

- `DRAWN_GRID_RADIUS` is the format's `GRID_RADIUS` (3), so the catalogue admits ring 3 and refuses ring 4. The
  sightline grows from ≈ 3.98 km to ≈ 5.57 km, the far ring's reach with it, and the road sky's dome from 4200 m to
  5800 m, still inside the 6000 m far plane.
- The roads stay where they were: the strips run round the placed cells' rectangle (`strips.ts`), so J305's 25 build
  the same deck, seams and baked collision as before. What is new is everything else inside the 7 × 7: the void floor
  (`src/shared/game/grid/voidFloor.ts`), road-level slabs over every empty cell inside the rectangle and over the band
  from the strips' outer edge to 20 m past the rail. The rail (the rim) moved from the 5 × 5's outer shoulder to the
  7 × 7's, for every catalogue (`gridRail`). An empty neighbour's strip edge already ends at y 0 (`assembly.ts`
  `emptyNeighbour`), so the slabs meet it flush.
- Every road world installs the same slabs: the page's highway physics (`session.ts`, rim kept as its readiness walls),
  the in-page server's road (`gridServer.ts`, fresh and restored) and a dedicated worker's road room (`openRoad`), both
  with the rim as plain walls. Before this the server roads had no rim at all: past the outer strip a player fell to
  `FALL_FLOOR`.
- The look: the existing Tron void floor (black, cyan lines that fade with distance) now starts at the old rail line
  (`RoadLayout.edge`) and adds one square per empty cell inside the rectangle (`RoadLayout.holes`); the rail beams stand
  on the 7 × 7 line (`RoadLayout.rail`). No new shader, no look pass (J281).
- Shard Select: `autoPlaced(row)` in `catalogueSlot.ts` is true when the installed catalogue's grid places the slug and
  its `placements` don't name it. api-server's SA30 writes only a `grid.cells` row (`grid-autoplace.ts`), never a
  placement, and every carded shard today has one (checked against `test/pins/catalogue.json` and `singleplayer.json`),
  so no card moves now. `titleCards` drops such rows even for Developer; `withCatalogueHeads` already needed a placement.

**Open.** SA33's runtime-opened cell is not known to the road room on another worker (no worker is told), so in the
road world its square is void floor with no crossing into it. Before SA34 that square had no floor at all, so this is
not a regression, but SA33's live proof needs the road room to learn the new cell (walls or a hand-off) before
`GRID_AUTOPLACE` is turned on.

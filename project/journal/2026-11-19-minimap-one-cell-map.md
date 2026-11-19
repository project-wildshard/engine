# The minimap and the Bag map choose a cell's map the same way (MAP-NEXT MN14)

buddy-engine, 2026-11-19. Rides v0.1.54.

Jake's "the minimap is broken" (QA 11-19 rows 15 and 28) was a flat disc where a zone's map should be: green in
Mossgate, grey in another zone. Two code paths picked a cell's image, and they disagreed:

- The Bag map (`fullMapOverlay`) went atlas tile, then the cell's own map, then a plain plot.
- The HUD minimap (`minimapOverlay`) went the cell's own map for the home. When that was null it drew painted
  heightfield ground at full strength (`baseAlpha 1`): the engine's ground, not the zone.

The hole under it: `CellMinimaps` swaps a flat author `look/map` for the cook's map only when one exists. A
build-pinned slug has no placed cooked map (`placedCookedMap` is undefined for build slugs), so Saltwind's and
Cinder Orchard's flat maps were drawn as they were, one dark colour.

Now there is one resolver, `cellMap(host, cell, atlas, load)` in `minimapBlend.ts`, and both overlays call it:

1. the cell's own map once loaded (the author's unless flat, else the cook's);
2. the build's atlas tile (a pinned slug's cooked render);
3. for a cell the atlas lacks (a placed upload), its own map loaded now.

`load` is true for the cell you stand in and the home; every other cell only peeks (`CellMinimaps.peek`, the new
`grid.mapPeek`). So the overview still never reads every cell's product (ZONE-ENTRY ZE14). A flat author map with no
cook's map now leaves the entry null, so the atlas tile draws. Painted ground stays only for a home with neither.

Tests (`mapAtlas.test.ts`), red on the old code first:

- (a) a flat author map with no fallback is no map, and the home then draws its atlas tile at alpha 1 with
  `baseAlpha 0`;
- (b) the road minimap and the Bag map pick the same image and crop for every cell.

The ZE14 road test now counts the home as an atlas tile too.

Proof: headless WebKit 402x874, local builds of v0.1.50 and of this change, hovering over Saltwind Lighthouse.
Saltwind is the build-pinned flat-map case in the local grid; Mossgate is placed only on staging, so its shot is
MN17's. Before: a dark empty disc. After: Saltwind's tile with its ground, plots and buildings
(`~/.cache/wildshard/plan-artifacts/map-next/mn14-*`; the pair is in meta `project/evidence/map-next/`).

A teleport into a cell does not make the grid count you inside it (`inside` stays null until a gate entry), so the
shot is the road minimap over the cell. That is the same `cellMap` choice the inside view makes.

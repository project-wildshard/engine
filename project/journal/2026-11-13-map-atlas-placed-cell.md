# A placed cell broke the Bag's Map tab (QA-FEEDBACK 2026-11-13 row 44)

Jake opened the Map tab on the Template shard and got Something Broke:
`Missing world map tile: open-plot-thin-ice`. After Keep Playing the tab
stayed a black box, because the full map's extras source threw on every
paint.

Why the tile was missing: the world map atlas is baked at build time
from the catalogue's `grid.cells`. `open-plot-thin-ice` is a listed
placement but not one of the build's 25 cells; a released page adds it
from the signed placement file (`placedCells.ts`, 13eca0f0). So the page
had a cell the atlas never heard of, and `mapAtlas.ts` threw.

Two halves:

- The build bakes a tile for every grid cell and every placement it
  built (27 slugs today). The review caught that an unbuilt placement
  would get the plot tile for good, hiding its real map, so those get
  no tile and take the runtime path below.
- A slug still missing (a shard carded from the API after the build,
  cd9ae4e1) reads null from the atlas, never a throw. The full map draws
  that cell's own baked map once it loads (the same per-shard read the
  minimap uses), and a plain-plot green square until then. One Sentry
  warning a slug a page, screen `map-tile-missing`.

Tests: `mapAtlas.test.ts` (null, one report a slug, the fallback map and
the plot square), `test/world-map-atlas.test.ts` (a placement-only slug
gets a tile), and the screen walk in `test/screen-reports.test.ts`.

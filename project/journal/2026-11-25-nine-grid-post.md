# Nine's declared post look in its grid cell (QA 11-24 row 69)

> Written by: Claude (opus-fast), 2026-11-25

Row 59 laid Nine Dragon's declared post look over its data look on its own shardfile page. In the grid, Nine is a
data cell (`liveSession` via `dataCellWorld`), and its cell hung only its data sky (`hangCellDataSky`), so the grid
drew Nine with no rain, no ink lines and a black street.

`hangCellDataPost` (`grid/cellDataPost.ts`) now builds the same post look for a resident data cell: its programs
compile first (`prepareWorldLook`), its chain is contributed to the grid frame for the cell's instance, its cell
composite (`replaces: 'chain'`) draws the cell's view root (`grid-cell:<instance>`, a new `cellRoot` port), and its
frame hook runs every update while resident. The first cut left the frame hook out: the composite ran, but its pixel
terms and channels were never written and the street stayed black. All of it leaves with the resident scope.

Local preview (Nine's card on the grid, Chromium 1280x720, 15 s after entry): before, mean luma 52.7 and 42.6% black;
after, the rain, ink lines and wet reflections draw, mean luma 89.0 and 6.3% black.

# Grid goes online (MMO-ZONE-SELECT GO3-GO5, QA row 13)

## GO3: the server hosts grid cells (MP1.4)

- Cells are named by grid instance from the catalogue (`gridCells.ts`); a room still
  runs and saves under its shard slug, so pre-GO3 saves read back.
- `WORLD_CELLS=grid` opens every grid cell the release names, home first.
  Local bench: 24 cells on 2 workers boot in ~2 s at ~1.2 GB RSS (the
  built bundle, memory saves); `template-2` waits for a `_template` pin.
- Frames carry the grid's cell number (catalogue index + 1), so a grid page
  reads Driftwood as Driftwood; frame 1 was Pine Hollow to a grid page.
- ZS7's place row lands here: migration 0003 `player_place`, written with
  every doc that lands, read first by `where()`, falling back to `lastCell`.
- `/health` gains `table`: each open cell and its worker.
- Walls stay (DG1): each cell is still `lone`; road and crossings are GO6.
- Recorded the new `test/dedicated-grid-cells.test.ts` clocks (full and Ring 1).

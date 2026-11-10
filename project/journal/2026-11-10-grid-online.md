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
- J206 Codex review (MUST fixed): `pull.mjs` now checks WORLD_CELLS after the
  bundle lands, through the `cells.json` the new bundle carries (written by
  `build-server.mjs`), so an instance like `open-plot-nw` is checked as its
  shard; `grid` needs a bundle that places cells. Tests pin the page catalogue
  to the server's grid order and check the restored body's position.
- Re-recorded the grid cell test clocks after the review's added cases.

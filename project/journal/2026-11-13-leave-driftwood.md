# Leave Driftwood (GRID-CROSSING GC28 to GC34)

> Written by: Claude (opus-gridleave), 2026-11-13

Jake, ~10:05 Cancún: "You cannot leave Driftwood ... you try to leave, you can't fucking leave. Whatever it takes."

- **Cause on staging (v0.1.16 `6d11b137`):** `WORLD_CROSSING` is unset there on purpose, so every cell opens lone and the
  server's edge wall holds the body at x -249.7. Reproduced with `grid-crossing-walk-proof.mjs --base=https://staging.wildshard.io`
  (new flag: a served site instead of the rig, never production) in headless Chromium and WebKit: no reload, no page error.
- **The rig with crossing on found two traps behind that wall.** (1) Far Reach is sky islands with no ground at any entryway at
  road height: a walker off the road arrived at Far Reach's spawn island, and every walk north fell off the island and back to
  its spawn, forever. (2) `WORLD_WORKERS=1` still opened two workers (Nalati alone), so the stopgap for the cross-worker gap
  did nothing.
- **GC31:** `workerTable(cells, 1)` is one row with every cell. Red first in `test/dedicated-table.test.ts`.
- **GC28:** a crossing worker whose book has no grid pack reads 0 strips; it now opens no road and keeps its cells lone,
  instead of wall-less cells over a road with no ground (`test/dedicated-road-no-strips.test.ts`, red first).
- **GC30:** a cell this worker hosts with no world ground at an entryway (probed at road height, +-8 m, per collider: a room
  nobody sat in has never stepped, so its broad phase sees nothing) is walled on the road like another worker's cell. A
  walker toward Far Reach stops on the road, standing, and runs back into Driftwood (`test/dedicated-road-no-ground.test.ts`,
  red first). Driftwood, Sunscar, Pine Hollow and Nalati all have ground at their four entryways; Far Reach at none.
- The walk proof also takes `--to=farreach|nalati` and `--workers=`.

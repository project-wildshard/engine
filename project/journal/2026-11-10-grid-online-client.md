# Grid goes online, the page half (MMO-ZONE-SELECT GO4, GO5)

## GO4: the grid page joins the MMO

- `serverRoute.ts`: a build with a world puts every page in it, grid pages
  too; `clientWorker.ts` asks it, and no in-page server starts early there.
- `startOnline` takes `grid`: a seat in another cell is reported, never a
  `?chunk=` reload; the live grid session already follows the frames'
  cell (J130), and GO3 made those numbers the grid's.
- Chat, voice, other players, the Name box and the strips come unchanged.
- Local proof (built server, memory saves, world-stamped build, headless
  Chromium): two grid pages online in Driftwood, frame 4, chat both ways,
  each sees the other, `/health` table lists both cells.

## GO5: one save on the MMO

- The door's `resume` (cell, at) rewrites `grid.last-played` through the
  live session, so it is only a hint; the loading card names the server's
  cell while it is up. Solo grid saves are never sent (DG3).

# Far Reach rev 3: docks at the four exits (opus-farreach)

- Sky Reach rev 3 (`cdbb400c`) gives Far Reach a dock at each entryway,
  so the GC30 road wall at Far Reach goes (J322) and a walker crossing
  in stands on the north dock instead of being set on the spawn island.
- Its phone tier is now copies of the desktop GLBs: 26.34 MB against
  the 25.98 MB latch. J338 says keep the look, so the ceiling is raised
  to the measured bytes with a J338 row (`45bc7c58`).
- The entry-socket fix (`e5bb69b6`) stays dropped: rev 3's docks are
  real ground, so the server needs no floor sockets to stand on.
- Preview's Driftwood to Far Reach crash, "proof.worker.present: null
  pointer passed to rust", reproduced on preview `1b2f1ac8` with a
  console stack: `NetMovers.frame` posed a mover view whose cell had
  gone (`FollowedMovers.follow` then `KinematicMover.setPose` on a
  freed body). `installFollowedMovers` put views on `wirePage.movers`
  and never took them off; the cell's scope now does, its own only
  (`followed-movers-dispose.test.ts`, red first).

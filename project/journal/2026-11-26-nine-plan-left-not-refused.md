# Nine's plan was left, not refused, after the native GPU restart

QA 11-25 row 152 (opus-boot151). Nine-dragon's native drill logged "declared plan refused: Tile resident
is disposed" after WebKit's GPU process restarted. A debug client logging every data-cell stay told the
story in 4 of 4 runs: the plan entered at ~1.5 s, and the grid session's step called `gridCells.leave()`
at ~3.8 s, right after the drill opened Explore's world view. Without the restart the drill waits 30 s for
a renderer wait that never comes, so the same leave lands long after the plan installed (3.4 s) and nobody
sees it. With the restart the drill reaches Explore sooner, and when the plan was still waiting on its
tiles (1 run in 4 here, 2 in 3 before) the leave's `leaveDataStays` disposed its stay under it. The scene
held the same content in refused and clean runs; only remote ghost players from earlier runs differed.

So nothing goes missing after a restart: the feet left Nine and its plan went with them, as it should,
and the next entry installs it again. The log was wrong. `enterDataStay` now reads a disposed stay as the
leave (quiet), and on a developer page marks every install's outcome (`wildshard.grid.data-stay`:
installed, left, refused), which nine-dragon's drill reads to wait for Nine's plan before Explore.

# SR4: after a crash the page and the server can stand in different places

Four WebKit runs of `--play --only=grid-entry` with `WS_GRID_CRASH=1`
now pass in full: road entry to Ember Forge, the cold GRID tap, a real
process kill and resume, and no page error. The native "Context is
stopped" no longer reproduces.

Chromium fails the process-kill step in four of five runs, at "The game
stopped loading at step server". The proof now prints the page's stores
after the restart and the server's latest frame. In all three Chromium
runs with that dump the page's `grid.last-played` and Ember's `platform.grid-position` were
gone after the kill: the page's localStorage held only the older road
record from the walk (Driftwood, road x 982). The server's documents
live in IndexedDB with strict durability, and in both failures with the
frame dump its first frame said cell 16, Ember Forge (`open-plot-4-1`). So the page booted on the road and the
server in Ember; the page drops frames for a cell it is not in, and the
loader never closes. In the passing Chromium run the stores were stale
the same way, and the page caught up with the server's site in time.

This is the cause class for S1's stuck Ember board: the recovery place
is lazily committed page storage, the continuation is durable worker
storage, and an abrupt end can split them. A tap after a clean exit
does not split them (both stores flushed), which is why the tap steps
pass everywhere.

Not changed here: the fix belongs in where the page takes its recovery
place (the server's durable copy, or following the server's restored
site before the loader waits on frames). The entry intent the row named
is already `pageGridIntents`; under J190 a tap and a recovery resume
the same way, so the server has nothing to choose between them.

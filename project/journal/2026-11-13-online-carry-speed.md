# Online crossings keep the walker's speed

GRID-CROSSING GC34, the online half. bfa15a65 made the page's
GridSimulation hand a walker to the arrival seat with velocity, clocks
and mode (`carryMotion`). The dedicated server's handover still made
the arrival body from pose and health only, so a walk off the road
into a cell stopped at the line.

Red first, `test/dedicated-carry-speed.test.ts`: a bench seat walks
north off Driftwood's south road into the cell, 4.3 m/s on the road,
0 m/s for a dozen samples past the line, then a ramp from rest.

Two stops, both fixed:

- `CrossTarget.admit` takes the leaving body (`motion`), and both
  rooms' `admit` run `carryMotion` on the new one. `handOver` passes
  its own body. A crossing is within one worker today, so the live
  body is right there; nothing goes through `cellProtocol`, and its
  messages are unchanged. Carrying a copy in the `cross` order would
  have been stale, read when the feet asked rather than when the
  door's save read came back.
- `standArrivals` sets an arrival on the bank top when the road runs
  lower than the cell's edge, with `resetPose`, which zeroes motion.
  It keeps the horizontal velocity, board, push and dash now.

A rider carries nothing: their speed lives on the mount they leave
behind, so they arrive on foot from rest (the review's catch; the old
walk velocity under a mount is stale).

`carryMotion` is exported from `simulation.ts` so the page and the
server share one list of what a crossing carries.

GC34 stays open: its browser proof waits on the Driftwood KTX2 fix.
A cross-worker handover (GC15 (3)) doesn't exist yet; when it does,
its message will need these motion fields.

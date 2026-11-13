# A placed cell reaches every road (SA34a)

> Written by: Claude (opus-sa34a), 2026-11-13

**The gap (opus-sa34b's review).** SA33 opens an API-placed cell on a running server on a worker of its own, and tells no
other worker. With roads on (`WORLD_CROSSING=worker`, GC15) every worker hosts a road room built at boot from the baked
catalogue: none of them knew the new cell. Its square stayed SA34's void floor, there were no strips round it, no walls
and no hand-off, so nobody on any road could walk in.

**A second gap under it.** GC15 crosses a seat only between rooms on one worker (its item 6, the cross-worker move, is not
built). So a cell on a worker of its own can never be walked into from any road, whatever the roads are told. With roads
on, a placed cell now opens on the worker of the open cell nearest it (Manhattan distance, ties to the first in the
table), the worker whose road a player walking to it is most likely on. Without roads nothing changes: SA33's own worker.
This is a reversible choice: once GC15 item 6 lands, the cell can go back to a worker of its own and the same notice still
lays out every road.

**What was built.**

- `place` order (door → every booted worker) with the placed rows and, for the chosen worker only, the cells to open; a
  `placed` answer with what opened or why not. A failure is answered, never thrown, so it can't end the process (Q77).
- A worker grows its road's grid first (`gridAssembly()`: the catalogue plus the placed cells), so the cell it opens gets
  its seams, then opens it, then `RoadRoom.place` lays the grown grid out: the void floor's tiles are lifted and laid
  again without the new square (the rim stays on the rail), the new strips go in, and walls go round any placed cell this
  worker can't hand a seat to.
- The strips: `placedStrips` (beside the void floor in `voidFloor.ts`) runs the page's own platform generator at road
  level (`platformInputs`' `flat`, the page's fallback; the server reads no edge rows) for the spots the grown rectangle
  has and the baked one hadn't. A first pass with `within` answering no lists the baked grid's spots without generating
  anything. A worker booted after a placement does the same at boot.
- `installVoidFloor` now answers its floor colliders, which `roadWorld.ts` keeps per road world so they can be lifted.

**Test.** `test/dedicated-placement-road.test.ts`: staging's 2-worker table with roads; Thin Ice placed at (0, 3) opens on
Driftwood's worker; on both roads its square has no floor and the strips north and east of it are there, Nalati's road
walls it and Driftwood's doesn't; a bot steps off Driftwood onto the road, is set down on the outer road just south of
Thin Ice, walks north by input and is handed into Thin Ice on the same socket. Red against the old sources (the cell
opened on a third worker).

**Still owed.** The new strips are road level on every side, not the shard's real edge rows, so a seam with terrain above
or below 0 meets the cell with a step (the hand-off stands a body on the cell's top). The page draws its own platform
from its own catalogue; whether its strips agree with these for a ring-3 cell is SA35's walk. A placed cell's worker
choice is a startup-style one: the cell never moves after.

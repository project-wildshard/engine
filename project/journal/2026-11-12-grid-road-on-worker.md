# The road on the worker (GC15, opus-gc15b)

- `WORLD_CROSSING=worker` (off by default) gives each worker a `RoadRoom`: the solo grid's road level (`roadWorld.ts`, split out of
  `gridServer.ts` so the dedicated worker doesn't pull in the solo grid), every strip built (C6), walls only round cells on other
  workers. Frame 0, as the page numbers the road. It keeps no progress: the cell a seat left wrote its save, so the place row stays.
- Each grid cell on that worker opens non-lone with its seam strips built in. The trigger is a plain per-seat feet check
  (`crossedTo`, 1 m past a border either way), not `installGridCrossing`: the door does the prepare/checkpoint part, and a crossing
  whose commit is an async door round trip doesn't fit that state machine.
- `handOver` now takes any `CrossTarget` (`admit` makes the body, `land` binds the link), so cell → road and road → cell use it.
- A road is named `road@<first cell on its worker>`, so the door finds its worker with no new table.
- Test: `test/dedicated-road-crossing.test.ts`, red with the trigger off. Not yet: the page side (frame 0 then the neighbour) and
  speed through a crossing (`resetPose` drops velocity).

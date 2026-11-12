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
- Review (one-shot `claude -p`): 2 MUSTs folded. A body coming off the road can land inside a cell's edge bank and fall out of the
  world: on its first tick in the cell (a world that slept has no scene queries until it steps) it stands on ground up to 8 m above
  its feet (red without it). And `seat` built its transport before a wake, which starts the port, so a quit during the wake was
  lost; the transport now comes after. SHOULDs folded: the road's own soft fall floor at -60 m (nobody walks under the walls),
  NaN feet skipped rather than thrown on, a `left` said mid-crossing applied if the crossing is abandoned, a stale road seat order
  says `left`, world chat reaches the road. Left: the reading and `/health` don't count the road; a held seat back on the road
  gets no `resume`.

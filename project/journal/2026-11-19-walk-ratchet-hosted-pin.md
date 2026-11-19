# The walk ratchet takes its hosted pin

MEMORY-STRUCTURE STR22 (mini-memstruct-m3c). The first hosted
memory-footprint run on main that judged Nine's walk was 44468967622 on
`41d629f2`: green, 3.56 MB/s [S] (3.44-3.83 over three runs) against the
mini's 7.30 pin. The next, 44470269928 on `f97bbeb9`, read 3.41
(3.32-3.41). The rate's baseline now lives in `budgets/baselines.json`
(BUDGET-CAPS BC11 moved it out of `walk-ratchet.json` while this lane
ran), so `cli.mjs record` writes the first reading there: 3.56 MB/s,
soft line 3.91.

The hosted runner allocates about half what the mini does per second on
the same code. The rate is per second, and the frame rate is not
recorded, so a hosted and a mini reading are not comparable; the pin is
the hosted one because the job runs there.

The hosted WebKit walk gets stuck on Nine's route (13 and 41 stuck
waypoints in two of six runs). Only the [K] peak comes from WebKit, and
it is reported, not judged, so the verdict is unaffected.

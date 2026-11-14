# Grid crossing, every pair (opus-gcm2)

- GC2: the breach matrix's last cases. `test/grid-wall-breach.test.ts` throws a fall from 12 m, a fall from the wall's 60 m
  top and a sprint along it at the server's road wall in front of a walled cell (Far Reach): all hold. The walk proof's
  `--breach` now also runs at the page's loading wall (preview Pine while it prepares), and stops when the wall opens, since
  entering a ready neighbour is the crossing working.
- GC4: since J320 every cell is resident from the worker's boot and sleep is only not ticking, so the one boot left on a
  crossing was a start-over (J107): a walker who stepped onto the road and turned back met Driftwood booting again at the
  line. `cellHost.ts` now defers a start-over while anyone on the worker's road stands within 40 m of that cell's edge
  (`RoadRoom.near`), and looks again every 5 s. `test/dedicated-start-over-near.test.ts`, red first.

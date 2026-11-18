# 2026-11-18: a grid data cell's look graphs (SHARD-SOURCE SS-GP6)

- Checked first, as the row asked: the grid's tile admission (`grid/session.ts`) compiles a data cell's look with
  `clientMaterials` and then never calls `graphs.bind` or `presentation.tick`. So a graph param bound to a state field
  stood at its declared default, and a day-bound one at the hour it compiled; look curves never moved. A one-shard page
  binds both (`client.ts`) and ticks the presentation every frame. No shipped data cell binds a graph to state today
  (Dunes does, but it is a client-plan cell with its own runtime), so nobody saw it.
- Fixed in `grid/dataCellLooks.ts`: session offers each admitted cell's look; one hook line in `liveSession.ts`
  (`followCellLooks`) binds it per stay to the page's hour and the cell's fields read the one-shard way, ticked by a
  system named for the cell, held mid-crossing. It subscribes itself so the merge with opus-gp123's `liveSession.ts`
  branch stays one line.
- Days and weather: a one-shard page uses `rows.days` only when the level has no clock of its own, and the grid always
  has the home's; its `rows.weather` map only reaches the debug handle. Neither is a grid gap. The post stack
  (`clientPostStack`) is still not built for a data cell; that is GRID-CELL-PARITY row 8, not this row.

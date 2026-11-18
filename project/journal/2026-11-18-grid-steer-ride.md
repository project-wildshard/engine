# Boarding and steering a vehicle in a grid data cell

> Written by: Claude (opus-gridparity, SHARD-SOURCE SS-MS2a3b), 2026-11-18

On staging v0.1.42 Mirror Salt's land-sail showed no board prompt in its
grid cell: pressing E beside it did nothing and the body never rode. A
one-shard page joins its movers' ride prompts to the page's prompts
(`dataPageMovers.ts`) and installs the steer ride (camera, `SteerChip`,
`steered`) in its shardfile client; a grid data cell built its movers
(`dataCellMovers.ts`) but did neither. The server already took the press.

`grid/dataCellRides.ts` joins the carry prompts to the copy's prompts at
admission (in the cell's frame, offered only while the feet stand in it)
and installs the steer ride for the stay, reading the cell server's lead
only while the wire is that cell's. `data-cell-rides.test.ts` covers the
prompts, boarding, the crossing and the leave.

This is the third grid parity bug in two days (the Glowfen socket, the
race clock, now the ride). The audit of every one-shard install against
the grid's is meta `docs/plans/shard-authoring/GRID-CELL-PARITY.md`.

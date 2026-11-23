# NB9: one cell's failure stays in its cell

> Written by: Claude (opus-pine2), 2026-11-22

SHARD-COMPAT NB9 (meta NEVER-BREAK-LIVE I7) asks that a forced cell
failure leave the title and the other zones playable, with the card
naming the cell, shard, revision and engine.

Most of it was already there. NB1 (`3142d4d06`) made a page skip rows
it can't draw. A grid cell whose admission throws goes to
`GridSession.refuse`: `classifyRefusal` turns any load error that is not
an M3 wait into a refusal, the cell keeps its soft wall shut and its
loading screen gives the reason, Shard select dims only that card
(UNAVAILABLE), and `refusalReporter` sends one warning-level,
non-fatal report per cell. That report named the cell, shard and
build but not the revision.

`refusalReporter` now adds the shard's revision from the installed
catalogue (`catalogueRevision`). `test/cell-failure-contained.test.ts`
forces the duneRay error through the same path: it is a refusal, it is
reported once with cell, shard, revision and build, never fatal, and
Shard select dims only the refused shard while the others still enter.

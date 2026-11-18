# A held tool's fuel and light in a grid data cell

> Written by: Claude (opus-gridparity, meta GRID-CELL-PARITY), 2026-11-18

The grid-cell parity audit (meta `docs/plans/shard-authoring/GRID-CELL-PARITY.md`)
found one more small gap: a one-shard page mirrors a held tool's fuel
and light (`targets.itemFields`, the lantern pickups SS-GF1a1b writes)
from the owner's owned lines onto the held item each frame; a grid data
cell's kit (`dataCellKit.ts`) never did, so a lantern on the grid
followed only the page's own guess. Both now take one mirror,
`shardfile/itemLines.ts`, the kit only while the wire is its cell's.

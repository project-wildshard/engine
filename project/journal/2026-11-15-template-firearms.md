# Templates on the grid: creatures, guns and racks (TEMPLATE-E2E TC-E1)

> Written by: Claude (opus-brassgun), 2026-11-15

Jake played Brasscap on staging and found no gun and no enemies. The probe (shard-brasscap `kit/scripts/play-probe.mjs`)
showed why: a grid data cell drew only the creatures its client scripts bind (Brasscap binds only its sand-ring
particles, and its lane was refused because it reads a state field the neighbour page doesn't hold), so all 12 bodies
were on the wire and none on screen.

- TC-E1a: `NeighbourLife.admit` now draws every spawn with a skin look in a data cell, and a refused lane leaves the
  bodies drawn. A native cell still leaves its creatures to its runtime.

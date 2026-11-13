# The probe reports the grid area the player is in (opus-t2e1b, TEMPLATE-E2E T2E-1b)

> Written by: Claude (opus-t2e1b), 2026-11-13

The Template 2 smoke (`pnpm run test:e2e`) went red at J311 (`f49d7e97`): a preview's Shard Select enters the grid, so
the page's level is `platform.grid` and the probe's `shard.slug` never reads `blender-template`. Past that, the probe
read the page shell: no `shardfile` debug handle (the cell is a data cell, so no door targets), and `state().quest`
read the shell runtime's hooks, `[]`, though the server held `blender.door` once E opened the door.

- `probe.area()`: the area the player is in, `{ slug, instance, targets, flags }`, null on the road. A grid page reads
  the current cell (`GridSession.area()`, `grid/area.ts`); a one-shard page its shard, its `shardfile` targets and its
  quest flags. `shard.slug` stays the page level: many harness scripts read `platform.grid` there.
- Door data: `NeighbourPanels.targets(instance)`, the panel drawn and solid while every collider stands in the admitted
  region (the same rule as `shardfile.targets()`).
- Flags: the wire lends its flags (`LiveGridWire.flags`, the server's flags plus phased), read only where the wire stands.
- The smoke reads `area()` and still goes through Shard Select (J233). `test/grid-area-probe.test.ts` is red without
  this (no area, no panel targets) and green with it.

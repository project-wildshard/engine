# Declared HUD and boss panels in a grid data cell

> Written by: Claude (opus-gp123, SHARD-SOURCE SS-GP3), 2026-11-18

A one-shard page mounts its `ui` rows (`mountDeclaredUi`) reading the
shard's fields and draws a `BossRowBar` per declared boss panel off the
wire's encounter rows. A grid data cell did neither: a copy's counters,
markers, Bag panels and boss bar were missing on the grid.

`shardfile/declaredHud.ts` now holds the field reader (`declaredFields`,
also what `client.ts`'s targets, graphs and scripts read) and the HUD
install (`installDeclaredHud`, boss panels included); `client.ts` calls
both. `grid/dataCellHud.ts` installs it per stay on the page's context
bound to the stay (`stayContext.ts`, whose system ids carry the cell so
the home's own `engine.declared.counters` never clashes). While the wire
is another cell's the counters and bars hold this cell's last word
rather than dropping to defaults; leaving the cell removes them.

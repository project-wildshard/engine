# 2026-11-16: a grid data cell's kills pay loot

TEMPLATE-E2E TC-E6 (Jake 2026-11-15, "kills drop loot"). A data cell had no personal loot; only the native runtime installed it.
`openDataCell` now installs `installPersonalLoot` off the shard's `economy` loot tables, fresh and on restore, and files coins and
trophies in the tick's effects. A one-shard page (`lone`) still pays its own lone player, so there the cell pays only a second one.
Test: `test/data-cell-loot.test.ts`.

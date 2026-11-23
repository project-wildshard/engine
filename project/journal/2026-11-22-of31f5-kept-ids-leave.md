# OF31f5: the kept item ids leave engine (2026-11-22)

> Written by: Claude (opus-of-close2)

ONE-FORMAT OF31f5. Driftwood r9 and Pine r11 declare their kept rows (OF31f3, OF31f4), and both are pinned, so `Owned.ts` loses the
closed `OWNED` list, `OwnedId` / `CosmeticId`, the whetstone, heart and charm ids and the legacy gauges. A shard with no kept rows keeps
nothing (`keptItems()` returns an empty set); the Bag reads hat and cape by their icon. `declaredLootEconomy` now takes the kept rows
it checks against. Tests read Driftwood's and Pine's rows from `test/fixtures/keptRows.ts`.

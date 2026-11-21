# OF31f2, OF31h1: kept items from the shard, the default cell from the grid

> Written by: Claude (opus-of-owned)

- Jake, 2026-11-21 ~14:07 Cancún: "all this tech debt has to be fixed now in one format or shard compat" (meta grill
  Q37). `OWNED` was a fixed list of 15 ids in engine; a save load silently dropped anything not on it.
- OF31f2: `Owned` now takes a `KeptItems` table built from its shard's items section (`kept` rows, format 0.67.0) and
  falls back to the old table only for a shard with none. Every call site checks ids and looks through the owner's
  table. A saved id the shard's rows don't name is kept in the save and written back, never dropped. The Bag's
  sharpening, sturdy-heart and charm pips read row gauges, so the whetstone/heart/charm ids leave `Owned`'s getters.
  `owned-kept.test.ts` is the old-save fixture: all 15 ids, under the table and under Driftwood's and Pine's rows.
- OF31h1: an unset `WORLD_CELLS` opens the grid's home cell (0, 0) from the placement instead of the slug in code.
- Format 0.67.0 pinned: it carries `kept` and `currency`, and the keeper programme goes optional, so
  `runtime-declared-sky.test.ts` guards a plan with none.
- OF31g2: `currency.ts` reads a shard's `economy/loot` currency row; the purse and kill bursts turn on for a declared
  currency, and for any loot row only until OF31g4 (Driftwood's doubloon is declared in OF31g3).

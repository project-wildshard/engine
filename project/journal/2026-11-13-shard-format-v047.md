# Engine pins shard-format v0.4.7 (SA29)

> Written by: Claude (opus-engpin047), 2026-11-13

Engine's `@wildshard/format` moves from `shard-format#v0.4.4` (`17539ea`) to `#v0.4.7` (`adca9dd`, tag object
`1a87c7c`), the engine half of SHARD-AUTHORING SA29's "then engine, sharddev and api-server take the pin". v0.4.5 to
v0.4.7 bring `./immutable` and its field parser (SI1), MoverBox/AnimalDims (SI3), stable issue codes (SA41), the
`./engineMusic` export, and the 7 × 7 grid: `GRID_RADIUS` 2 → 3, `GRID_CELL_COUNT` 25 → 49 as a maximum, any cell empty.

No player sees a change. The grid catalogue check dropped "exactly `GRID_CELL_COUNT` cells" (it would have refused
J305's 25 at 49), so a catalogue may leave cells empty, and both J305 catalogues read back deep-equal. The engine still
places and draws only the 5 × 5: `catalogue.ts`'s new `DRAWN_GRID_RADIUS = 2` bounds every cell, so a ring-3 placement
is refused exactly as before the pin, and `farProxy.ts` builds `GRID_SIGHTLINE` (≈ 3.98 km), `FAR_RING.reach` and the
road sky's `domeRadius` (4200 m) from it. The review caught why the bound matters: api-server's SA30 spiral starts new
slugs at (0,3), and a far view sized for ring 2 would show that cell popping in past the dome. SA34 (the client's 7 × 7
and its void floor) moves `DRAWN_GRID_RADIUS` to `GRID_RADIUS`; until then a ring-3 placement on a live channel still
refuses the catalogue, as it did on v0.4.4. The continuation cache's entry cap and the strip builder follow
`GRID_CELL_COUNT` and `GRID_RADIUS` (49, radius 3) on their own; behind the catalogue's bound neither does anything new.

`test/engine-music-names.test.ts` imports `ENGINE_MUSIC_SLOTS` from `@wildshard/format/engineMusic` (AU18's note)
instead of reaching into `node_modules`. The two wire lock rows lost `gitHosted` again on install and are restored by
hand (WR2); the format row now carries pnpm's integrity.

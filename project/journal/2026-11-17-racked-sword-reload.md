# A reload keeps the racked sword in hand

TEMPLATE-E2E TC-SHIP-e2 (opus-te2e7). On staging v0.1.34 a refresh or a new tab put the player back where they stood, with
`weapon.sword-iron.taken` 1 on the wire, but the Template's iron sword was off the hotbar. `grid/dataCellKit.ts` built its
racked set by `weapon.id` (the page's `declared.weapon.sword-iron`) while `rackMeleeRows` and the server's taken line name the
row (`weapon.sword-iron`), so the set was always empty: only the take's own scene brought the sword to hand, never a taken line
read at entry. The standalone client (`shardfile/client.ts`) already matched by `row.id`. Test: `test/data-cell-rack-taken.test.ts`.

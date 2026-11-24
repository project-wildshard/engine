# FP22d: a weapon without a slot is found by its item

> Written by: Claude (opus-prune2). 2026-11-24.

Driftwood's FP22d revision (`00d88d5`, SDK 0.4.31) never entered on engine v0.1.84: phone WebKit preparation timed out on
Linux, on macOS and locally, and the page reported `EquipmentService: no weapon 'declared.weapon.sword' in the kit`.

The kit keys a weapon by its item row's `slot` (`declared.weapon.driftwood-isle.wood`, `items.ts`), but four callers
built the id from the item's equipment row (`weapon.sword`). Each id is the same only where the item and its
equipment share one id, which holds for Pine's and Nalati's weapons but not for Driftwood's swords:

- `client/game/loadout/effects.ts` (item effects, the boot crash) now finds the weapon by its item (`byItem`);
- `server/game/loadout/nativeAmmunition.ts` and `server/game/loadout/ownedEffects.ts` also accept `declared.<item id>`;
- `shared/game/legacySlotMigration.ts` renames a slot to `declared.<item id>`, the id the kit plays it under.

`test/legacy-slot-migration.test.ts` keeps the item-not-equipment case. Driftwood and Pine republish on the first engine
release that carries this fix.

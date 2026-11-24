# 2026-11-24: every weapon id is a declared item (FORMAT-PRUNE FP22e engine half, built ahead)

> Written by: Claude (opus-fp21)

`weaponIdOf` now always returns `declared.<equipment id>`. `EquipmentRow` loses `legacySlot`, and the client's
`EquipmentSlotMap` loses the closed names (`crossbow`, `sword`, `rifle`, `sword-iron`, `bow`, `sabre`, `spear`,
`empty`) and merges the declared ids instead. Three kinds of weapon used `legacySlot` to wear a closed id: the starter
swords, the empty hand and the headless native kits. They now play under their items' ids, so `sword` becomes
`declared.weapon.sword` and the empty hand becomes `declared.weapon.empty`. The client and server move together in one
release. A save keyed by a closed name moves through FP22c's bridge (`legacySlotMigration.ts`), now the only `src/` file
that names the field.

It needs format with FP22e (`plan/fp22e`), whose `WeaponSlot` holds only declared ids. Against that format the
typecheck is clean, apart from one unrelated test that breaks on a newer format main change. Three tests load today's
pins (Pine, Nalati, Nine), which still carry the field, so they pass only once the FP22d re-pins land:
`held-loadout-platform`, `pine-rewards` and `nalati-practice-verbs`. Three frozen fixtures dropped the field. Held on
`plan/fp22e` until the four FP22d zones are pinned and engine pins the format that deletes it.

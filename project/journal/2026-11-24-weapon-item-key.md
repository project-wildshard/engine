# 2026-11-24: weapons keyed by item beside legacySlot (FORMAT-PRUNE FP22b)

> Written by: Claude (opus-fp21)

`items.legacySlot` is the native loadout's closed weapon id; it keys the strip, skins and worn-skin saves, ammunition and
effects, so it cannot simply go (FP22's census). FP22b is the additive first step: `weaponIdOf` names a weapon's runtime
id, the closed name when the row has one and `declared.<item id>` otherwise (held melee's existing convention), `Weapon`
takes it instead of refusing a row without a slot, the equipment service finds a weapon by the item that declares it, and
item effects and owned effects resolve through the same helper. Every row that has `legacySlot` keeps exactly the id it
had, so no pin, save or skin moves. FP22c (the save migration, tested over real saves and kept originals) comes next.

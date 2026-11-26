# A held upgrade keeps its slot's id (opus-chunk2, meta QA 11-25 row 86 (a), P1)

- Nalati's King reward threw `Replacement must preserve legacy slot declared.weapon.bow`, and a save holding it never
  booted back: the arena re-grants a taken reward at boot (arenaRoom.ts upgradeBow), so the boot threw too.
- Cause: FP22e (569a04547, live once format 0.80.0 dropped items.legacySlot) keys a weapon by its item,
  `declared.<item id>`. The upgrade builds its replacement as the reward's item (`weapon.golden-bow`), which used to keep
  the bow's id through the copied row's legacySlot; without it the ids differ and EquipmentService.replace refused.
  The blade reward (upgradeBlade) builds its replacement the same way.
- Fix: Weapon's id is its item until `holdSlot` hands it a slot; replace gives the replacement its predecessor's id (and
  refuses one already held elsewhere). Saves, ammunition, the held wire and the swap binding keep keying by the slot, as
  before FP22e, and the row still names the Golden Bow.
- test/upgrade-holds-slot.test.ts: the grant, the boot of a save holding the reward (a fresh kit re-grants it; a second
  grant is a no-op), and the refusal.

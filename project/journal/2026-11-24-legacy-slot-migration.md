# 2026-11-24: the legacy slot save migration (FORMAT-PRUNE FP22c)

> Written by: Claude (opus-fp21)

The one save keyed by `legacySlot` is the worn-skin map (`skinSave.worn`, keyed by a weapon's runtime id). FP22b made that
id `declared.<item>` for a row without a slot; FP22c is the step a shard declares in the revision that drops its slots:
`legacySlotMigration(items.rows, from)` renames each slot to its item's id through the format's existing `equipmentSlots`
rows, which `SkinLocker` already applies on load. It is additive: a save with no step reads as before, the canonical key
wins after an interrupted upgrade, a second load changes nothing, and `renameSlots(worn, reversed(renames))` takes a
migrated save back for a revision that still names slots (the format only declares renames toward `declared.weapon.*`).

Fixtures, all in the round-trip test (`test/legacy-slot-migration.test.ts`):

- `test/fixtures/legacy-slot-originals.json`: every kept original of Driftwood, Nalati, Nine Dragon and Pine Hollow (24
  revisions, read from the API's public list by `project-wildshard-meta project/evidence/format-prune/fp22c/probe/originals.mjs`). Equipment ids never changed across
  revisions; only Pine Hollow keys skins by slot (crossbow and rifle, seven skins).
- `test/fixtures/saves/worn-skins-dev.json`: what the real skin save path wrote in the dev world, holding each skinned
  weapon and wearing each skin, per shard (meta `project/evidence/format-prune/fp22c/`). The page's skin locker and each
  grid cell's are now exposed to debug probes (`window.__wildshard.shard.skins`, `skins.<instance>`) for that.
- The locked `v2-*` save fixtures, which carry no worn map.

The dev world also showed Nine Dragon's jian already plays as `declared.weapon.jian` though its row names `legacySlot:
sword` (held melee keys by item), so only Pine Hollow (crossbow and lever-action skins) has slot-keyed worn saves; the
step's `sword` rename there is a no-op. Driftwood and Nalati hold no weapon skins.

Real staging saves: the agent account had no read of save contents (only `saves list`, ids and names), so
`wildshard-config saves worn` now counts staging's worn keys per shard, revision, slot and skin with a plain select and no
player id; it reaches the box with the next applied tag.

Nalati's finishes (`held/finishes` cosmetics) key their own declared slots (`sabre`, `bow`, `arrows`, `mount`) through a
locker with no migrations, and the held kit resolves those ids from its own claims rows, so neither moves when the items
drop `legacySlot`.

# A melee weapon taken from a rack (TEMPLATE-E2E TC-E4)

> Written by: Claude (opus-brassgun3), 2026-11-15

J361 (Jake, 2026-11-15): Mossgate's sword is found on a rack. A data shard's scene take only handled levers, so a melee row with a
rack take (an `itemActions` row of action 3) was in hand from the start.

- `rackMeleeRows(shard)` (`src/shared/game/shardfile/items.ts`): the `kit.melee` weapons an action-3 scene takes, bar the loadout primary.
- Server (`declaredKitItems.ts`): each player's seat holds a `racked` set. A swap to a racked weapon is spent; a held racked weapon
  strikes nothing; the take, near the rack's prompt, empties that rack and puts the weapon in hand. The set saves under `#racked`;
  a save from before has none, so its weapons stay racked. Each rack weapon publishes the owned line `<id>.taken`
  (`takenLine`, which `leverLines` now uses too).
- Client (`dataCellKit.ts`): a racked weapon starts locked and unlocks and comes to hand when its line reads 1, as a lever does.
- Test: `test/declared-rack-melee.test.ts` (Template's sword on a fixture rack).

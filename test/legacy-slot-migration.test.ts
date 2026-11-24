// FORMAT-PRUNE FP22c: the save migration that lets a shard drop `legacySlot` (worn skins keyed by a weapon's closed slot move
// to the id the weapon plays under without one, FP22b's `weaponIdOf`), round-tripped over made-up rows and real saves:
// - test/fixtures/saves/worn-skins-dev.json: the saves the real skin save path wrote in the dev world, holding each skinned
//   weapon and wearing each of its skins (project-wildshard-meta project/evidence/format-prune/fp22c/); each shard's weapon
//   rows are made up from those saves (the slot each weapon was saved under, the item it plays as);
// - test/fixtures/saves/v2-*.json: the locked real save fixtures.
// ZONE-SNAPSHOTS ZS8 (J507): the kept originals' item rows (legacy-slot-originals.json) are gone; no zone revision is read.
import { readFileSync } from 'node:fs';
import { migrateEquipmentSlots, parseMigrations } from '@wildshard/format/migrations';
import { describe, expect, test } from 'vitest';
import { legacySlotMigration, legacySlotRenames, renameSlots, reversed, type SlottedItemRow } from '../src/shared/game/legacySlotMigration';

interface DevWorld { shard: string; weapons: { id: string; item: string }[]; skins: { id: string; weapon: string }[]; saves: { step: string; save: { owned: string[]; worn: Record<string, string> } }[] }
const devWorld = (JSON.parse(readFileSync('test/fixtures/saves/worn-skins-dev.json', 'utf8')) as { shards: DevWorld[] }).shards;
/** A shard's weapon rows, made up from its dev-world saves: each weapon under the slot it was saved by, or none when it
 *  already plays under its declared id (held melee, Nine Dragon's jian). */
const rowsOf = (world: Pick<DevWorld, 'weapons'>): SlottedItemRow[] => world.weapons.map(weapon => ({ kind: 'weapon', id: weapon.item,
  equipment: { id: weapon.item, ...weapon.id === `declared.${weapon.item}` ? {} : { legacySlot: weapon.id } } }));
const worldOf = (shard: string): DevWorld => {
  const world = devWorld.find(row => row.shard === shard);
  if (world === undefined) throw new Error(`no dev-world saves of ${shard}`);
  return world;
};

/** Forward through the format's declared step, back through the pure inverse; both ways keep every value. */
function roundTrip(rows: readonly SlottedItemRow[], worn: Readonly<Record<string, string>>): void {
  const step = legacySlotMigration(rows, 7), declared = parseMigrations([step]), renames = legacySlotRenames(rows);
  const migrated = migrateEquipmentSlots(worn, declared);
  expect(migrateEquipmentSlots(migrated, declared)).toEqual(migrated);
  expect(Object.values(migrated).sort()).toEqual(Object.values(worn).sort());
  for (const { from, to } of renames) {
    expect(Object.hasOwn(migrated, from)).toBe(false);
    if (Object.hasOwn(worn, from)) expect(migrated[to]).toBe(worn[from]);
  }
  expect(renameSlots(migrated, reversed(renames))).toEqual(worn);
  expect(migrateEquipmentSlots(worn, [])).toEqual(worn);
}

describe('legacy slot to declared item', () => {
  test('the dev world covers every pinned shard with slots, and each declares a valid step: every slot to its item, none twice', () => {
    expect(new Set(devWorld.map(row => row.shard))).toEqual(new Set(['driftwood-isle', 'nalati-grasslands', 'nine-dragon-stack', 'pine-hollow']));
    for (const world of devWorld) {
      const rows = rowsOf(world), step = legacySlotMigration(rows, 3);
      expect(() => parseMigrations([step])).not.toThrow();
      expect(step.equipmentSlots).toEqual(world.weapons.filter(weapon => weapon.id !== `declared.${weapon.item}`)
        .map(weapon => ({ from: weapon.id, to: `declared.${weapon.item}` })));
      for (const skin of world.skins) expect(world.weapons.some(weapon => weapon.id === skin.weapon), `${world.shard} ${skin.id}`).toBe(true);
    }
  });

  test('every worn skin and every dev-world save migrates, stays put on a second load, and comes back', () => {
    for (const world of devWorld) {
      const rows = rowsOf(world);
      for (const skin of world.skins) roundTrip(rows, { [skin.weapon]: skin.id });
      roundTrip(rows, Object.fromEntries(world.weapons.map(weapon => [weapon.id, `skin.${weapon.item}`])));
      for (const { save } of world.saves) roundTrip(rows, save.worn);
    }
  });

  test('the dev world\'s last Pine Hollow save keys its skins by slot', () => {
    expect(worldOf('pine-hollow').saves.at(-1)?.save.worn).toEqual({ crossbow: 'warden', rifle: 'scarback-furnace' });
  });

  test('the locked save fixtures carry no slot-keyed worn map, so the step leaves them as they are', () => {
    for (const name of ['v2-driftwood-isle', 'v2-global']) {
      const keys = (JSON.parse(readFileSync(`test/fixtures/saves/${name}.json`, 'utf8')) as { keys: Record<string, { data?: unknown }> }).keys;
      const worn = (keys['skins']?.data as { worn?: Record<string, string> } | undefined)?.worn ?? {};
      roundTrip(rowsOf(worldOf('driftwood-isle')), worn);
    }
  });

  test('an interrupted upgrade keeps the declared key, an unrelated key stays, and two weapons on one slot are refused', () => {
    const rows: SlottedItemRow[] = [{ kind: 'weapon', id: 'weapon.crossbow', equipment: { id: 'weapon.crossbow', legacySlot: 'crossbow' } }];
    expect(migrateEquipmentSlots({ crossbow: 'old', 'declared.weapon.crossbow': 'new', mount: 'night-rider' }, parseMigrations([legacySlotMigration(rows, 1)])))
      .toEqual({ 'declared.weapon.crossbow': 'new', mount: 'night-rider' });
    expect(legacySlotRenames([{ kind: 'weapon', id: 'weapon.sunscar-whip', equipment: { id: 'weapon.sunscar-whip' } }, { kind: 'tool', id: 'tool.rope' }])).toEqual([]);
    expect(() => legacySlotRenames([...rows, { kind: 'weapon', id: 'weapon.heavy', equipment: { id: 'weapon.heavy', legacySlot: 'crossbow' } }]))
      .toThrow('Weapons weapon.crossbow and weapon.heavy both name legacySlot crossbow');
  });
});

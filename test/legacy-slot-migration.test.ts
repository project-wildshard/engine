// FORMAT-PRUNE FP22c: the save migration that lets a shard drop `legacySlot` (worn skins keyed by a weapon's closed slot move
// to the id the weapon plays under without one, FP22b's `weaponIdOf`), round-tripped over every fixture the lane gathered:
// - test/fixtures/legacy-slot-originals.json: every kept original of the four pinned shards with slots (the API's public
//   list, read by project-wildshard-meta project/evidence/format-prune/fp22c/probe/originals.mjs), so each revision a worn skin could come from is covered;
// - test/fixtures/saves/worn-skins-dev.json: the saves the real skin save path wrote in the dev world, holding each skinned
//   weapon and wearing each of its skins (project-wildshard-meta project/evidence/format-prune/fp22c/);
// - test/fixtures/saves/v2-*.json: the locked real save fixtures.
import { readFileSync } from 'node:fs';
import { migrateEquipmentSlots, parseMigrations } from '@wildshard/format/migrations';
import { describe, expect, test } from 'vitest';
import { legacySlotMigration, legacySlotRenames, renameSlots, reversed, type SlottedItemRow } from '../src/shared/game/legacySlotMigration';

interface Original { shard: string; revision: number; weapons: { item: string; equipment: string | null; legacySlot: string | null }[]; skins: { id: string; weapon: string }[] }
interface DevWorld { shard: string; weapons: { id: string; item: string }[]; skins: { id: string; weapon: string }[]; saves: { step: string; save: { owned: string[]; worn: Record<string, string> } }[] }
const originals = (JSON.parse(readFileSync('test/fixtures/legacy-slot-originals.json', 'utf8')) as { originals: Original[] }).originals;
const devWorld = (JSON.parse(readFileSync('test/fixtures/saves/worn-skins-dev.json', 'utf8')) as { shards: DevWorld[] }).shards;
const rowsOf = (original: Pick<Original, 'weapons'>): SlottedItemRow[] => original.weapons.map(weapon => ({ kind: 'weapon', id: weapon.item,
  ...weapon.equipment === null ? {} : { equipment: { id: weapon.equipment, ...weapon.legacySlot === null ? {} : { legacySlot: weapon.legacySlot } } } }));

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
  test('the fixtures cover every pinned shard with slots, and every kept skin keys a slot its revision declares', () => {
    expect(new Set(originals.map(row => row.shard))).toEqual(new Set(['driftwood-isle', 'nalati-grasslands', 'nine-dragon-stack', 'pine-hollow']));
    expect(originals.length).toBeGreaterThanOrEqual(24);
    for (const original of originals) {
      const slots = new Set(original.weapons.map(weapon => weapon.legacySlot));
      for (const skin of original.skins) expect(slots.has(skin.weapon), `${original.shard} r${String(original.revision)} ${skin.id}`).toBe(true);
    }
    expect(new Set(devWorld.map(row => row.shard))).toEqual(new Set(['driftwood-isle', 'nalati-grasslands', 'nine-dragon-stack', 'pine-hollow']));
  });

  test('each kept original declares a valid step: every slot to its declared item, none twice', () => {
    for (const original of originals) {
      const step = legacySlotMigration(rowsOf(original), 3);
      expect(() => parseMigrations([step])).not.toThrow();
      expect(step.equipmentSlots).toEqual(original.weapons.filter(weapon => weapon.legacySlot !== null && weapon.equipment !== null)
        .map(weapon => ({ from: weapon.legacySlot, to: `declared.${String(weapon.equipment)}` })));
    }
  });

  test('a worn skin from every kept original migrates, stays put on a second load, and comes back', () => {
    for (const original of originals) {
      const rows = rowsOf(original);
      for (const skin of original.skins) roundTrip(rows, { [skin.weapon]: skin.id });
      roundTrip(rows, Object.fromEntries(original.skins.map(skin => [skin.weapon, skin.id])));
      roundTrip(rows, Object.fromEntries(original.weapons.flatMap(weapon => weapon.legacySlot === null ? [] : [[weapon.legacySlot, `skin.${weapon.item}`]])));
    }
  });

  test('every dev-world save round-trips against its shard\'s newest kept original', () => {
    for (const world of devWorld) {
      const newest = originals.filter(row => row.shard === world.shard).sort((a, b) => b.revision - a.revision)[0];
      if (newest === undefined) throw new Error(`no kept original of ${world.shard}`);
      // a weapon plays under its slot, or (held melee, Nine Dragon's jian) already under its declared id, which no step renames
      for (const weapon of world.weapons) {
        expect(newest.weapons.some(row => row.equipment === weapon.item && (row.legacySlot === weapon.id || weapon.id === `declared.${weapon.item}`)), `${world.shard} ${weapon.id}`).toBe(true);
      }
      for (const { save } of world.saves) roundTrip(rowsOf(newest), save.worn);
    }
  });

  test('the dev world wore every skin Pine Hollow keeps, and its saves key them by slot', () => {
    const pine = devWorld.find(row => row.shard === 'pine-hollow'), newest = originals.filter(row => row.shard === 'pine-hollow').sort((a, b) => b.revision - a.revision)[0];
    expect(new Set(pine?.skins.map(skin => skin.id))).toEqual(new Set(newest?.skins.map(skin => skin.id)));
    expect(pine?.saves.at(-1)?.save.worn).toEqual({ crossbow: 'warden', rifle: 'scarback-furnace' });
  });

  test('the locked save fixtures carry no slot-keyed worn map, so the step leaves them as they are', () => {
    for (const name of ['v2-driftwood-isle', 'v2-global']) {
      const keys = (JSON.parse(readFileSync(`test/fixtures/saves/${name}.json`, 'utf8')) as { keys: Record<string, { data?: unknown }> }).keys;
      const worn = (keys['skins']?.data as { worn?: Record<string, string> } | undefined)?.worn ?? {};
      for (const original of originals.filter(row => row.shard === 'driftwood-isle')) roundTrip(rowsOf(original), worn);
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

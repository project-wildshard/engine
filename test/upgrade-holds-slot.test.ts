// Meta QA 11-25 row 86 (a): Nalati's King reward threw `Replacement must preserve legacy slot declared.weapon.bow`, and a
// save holding it never booted back (the arena re-grants a taken reward at boot). FP22e keys a weapon by its item, so the
// Golden Bow (`weapon.golden-bow`) can't carry the bow's id the way `legacySlot` did; the replacement now holds its
// predecessor's slot. These run the arena's two paths on the service: the grant, and the boot of a save holding it.
import { describe, expect, it } from 'vitest';
import { weaponIdOf, type EquipmentRow, type WeaponId } from '@wildshard/engine/combat/Equipment';
import { Weapon } from '@wildshard/engine/combat/Weapon';
import { EquipmentService } from '../src/client/engine/combat/EquipmentService';

/** The service's own surface on a real Weapon id, with nothing drawn or fired. */
function weapon(id: string): Weapon {
  const row = { id, ui: {} } as unknown as EquipmentRow;
  const w = Object.create(Weapon.prototype) as Weapon & { slotId: WeaponId };
  Object.assign(w, { row, slotId: weaponIdOf(row), state: { ammo: 3, reserve: 9, loaded: true, reloading: false, reloadProgress: 0, ads: false },
    holster: 0, model: { visible: false }, install: () => undefined, setActive: () => undefined, dispose: () => undefined, wire: null });
  return w;
}

/** claims.ts `upgradeBow`: the replacement row is the reward's item; replace keeps the slot. */
function upgrade(service: EquipmentService, item: string): Weapon {
  const previous = service.byItem('weapon.bow') ?? service.byItem(item);
  if (previous === undefined) throw new Error('no bow');
  if (previous.row.id === item) return previous;
  const next = weapon(item);
  service.replace(previous.id, next);
  return next;
}

describe('a reward that replaces a held weapon', () => {
  it('takes the King\'s bow without throwing, under the bow\'s slot, as the Golden Bow', () => {
    const bow = weapon('weapon.bow'), service = new EquipmentService(bow);
    const golden = upgrade(service, 'weapon.golden-bow');
    expect(golden.id).toBe('declared.weapon.bow');
    expect(golden.row.id).toBe('weapon.golden-bow');
    expect(service.get('declared.weapon.bow' as WeaponId)).toBe(golden);
    expect(service.byItem('weapon.golden-bow')).toBe(golden);
    expect(golden.state.ammo).toBe(3);
  });

  it('boots a save holding the reward: a fresh kit re-grants it, and a second grant is a no-op', () => {
    // The save keeps `rewardTaken`; the arena calls upgradeBow on a fresh loadout at boot (arenaRoom.ts).
    const service = new EquipmentService(weapon('weapon.bow'));
    const restored = upgrade(service, 'weapon.golden-bow');
    expect(upgrade(service, 'weapon.golden-bow')).toBe(restored);
    expect(service.get('declared.weapon.bow' as WeaponId)?.row.id).toBe('weapon.golden-bow');
  });

  it('still refuses a replacement already held under another slot', () => {
    const service = new EquipmentService(weapon('weapon.bow'));
    service.add(weapon('weapon.golden-bow'), { locked: false });
    expect(() => service.replace('declared.weapon.bow' as WeaponId, weapon('weapon.golden-bow'))).toThrow(/already held/u);
  });
});

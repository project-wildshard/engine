// FORMAT-PRUNE FP22b: a weapon is keyed by its closed `legacySlot` when its row has one, and by its item otherwise; the
// equipment service finds either by the item that declares it.
import { describe, expect, it } from 'vitest';
import { weaponIdOf, type EquipmentRow, type WeaponId } from '@wildshard/engine/combat/Equipment';
import { EquipmentService } from '../src/client/engine/combat/EquipmentService';
import type { Weapon } from '@wildshard/engine/combat/Weapon';

describe('weaponIdOf', () => {
  it('keeps the closed name when the row has one, so saves, skins and ammunition read as before', () => {
    expect(weaponIdOf({ id: 'weapon.longbow', legacySlot: 'bow' as WeaponId })).toBe('bow');
    expect(weaponIdOf({ id: 'weapon.jian', legacySlot: 'sword' as WeaponId })).toBe('sword');
  });
  it('keys a row without one by its item, as held melee already did', () => {
    expect(weaponIdOf({ id: 'weapon.jian' })).toBe('declared.weapon.jian');
  });
});

describe('EquipmentService.byItem', () => {
  /** The service's own surface on a weapon, with nothing drawn or fired. */
  const weapon = (row: Pick<EquipmentRow, 'id' | 'legacySlot'>): Weapon => ({
    id: weaponIdOf(row), row: { ...row, ui: {} }, slot: 'main', state: { ammo: 0 },
    install: () => undefined, setActive: () => undefined, wire: null,
  }) as unknown as Weapon;

  it('finds a closed-name weapon and a declared one by the item that declares it', () => {
    const bow = weapon({ id: 'weapon.longbow', legacySlot: 'bow' as WeaponId }), jian = weapon({ id: 'weapon.jian' });
    const service = new EquipmentService(bow);
    service.add(jian, { locked: false });
    expect(service.byItem('weapon.longbow')).toBe(bow);
    expect(service.byItem('weapon.jian')).toBe(jian);
    expect(service.get('declared.weapon.jian' as WeaponId)).toBe(jian);
    expect(service.byItem('weapon.missing')).toBeUndefined();
  });
});

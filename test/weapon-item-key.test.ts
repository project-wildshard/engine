// FORMAT-PRUNE FP22b/FP22e: a weapon is keyed by its item, `declared.<equipment id>`; the closed slot names are gone,
// and the equipment service finds a weapon by the item that declares it.
import { describe, expect, it } from 'vitest';
import { weaponIdOf, type EquipmentRow, type WeaponId } from '@wildshard/engine/combat/Equipment';
import { EquipmentService } from '../src/client/engine/combat/EquipmentService';
import type { Weapon } from '@wildshard/engine/combat/Weapon';

describe('weaponIdOf', () => {
  it('keys every row by its item', () => {
    expect(weaponIdOf({ id: 'weapon.jian' })).toBe('declared.weapon.jian');
    expect(weaponIdOf({ id: 'weapon.longbow' })).toBe('declared.weapon.longbow');
  });
});

describe('EquipmentService.byItem', () => {
  /** The service's own surface on a weapon, with nothing drawn or fired. */
  const weapon = (row: Pick<EquipmentRow, 'id'>): Weapon => ({
    id: weaponIdOf(row), row: { ...row, ui: {} }, slot: 'main', state: { ammo: 0 },
    install: () => undefined, setActive: () => undefined, wire: null,
  }) as unknown as Weapon;

  it('finds each weapon by the item that declares it', () => {
    const bow = weapon({ id: 'weapon.longbow' }), jian = weapon({ id: 'weapon.jian' });
    const service = new EquipmentService(bow);
    service.add(jian, { locked: false });
    expect(service.byItem('weapon.longbow')).toBe(bow);
    expect(service.byItem('weapon.jian')).toBe(jian);
    expect(service.get('declared.weapon.jian' as WeaponId)).toBe(jian);
    expect(service.byItem('weapon.missing')).toBeUndefined();
  });
});

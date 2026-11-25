// FORMAT-PRUNE FP57: Driftwood's republish never entered on v0.1.89's preparation client ("Item effect weapon
// weapon.driftwood-isle.wood is not in the kit"). Its swords are `row: 'native'` runtime owners, which keep their native row
// and id (`sword`, row `weapon.sword`), so neither the item (`declared.<item id>`) nor the equipment's id named them.
import { expect, test } from 'vitest';
import { kitWeaponOf } from './effects';

const kit = (list: { id: string; row: { id: string } }[]) => ({ list, byItem: (item: string) => list.find(w => w.row.id === item) });

test('a native owner is found by the equipment row it wears (Driftwood\'s swords)', () => {
  const weapons = kit([{ id: 'sword', row: { id: 'weapon.sword' } }, { id: 'sword-iron', row: { id: 'weapon.sword-iron' } }]);
  expect(kitWeaponOf(weapons, 'weapon.driftwood-isle.wood', { id: 'weapon.sword' }).id).toBe('sword');
  expect(kitWeaponOf(weapons, 'weapon.driftwood-isle.iron', { id: 'weapon.sword-iron' }).id).toBe('sword-iron');
});

test('the item row and the declared id still win, in that order', () => {
  const byRow = kit([{ id: 'declared.weapon.a', row: { id: 'weapon.a' } }, { id: 'x', row: { id: 'weapon.sword' } }]);
  expect(kitWeaponOf(byRow, 'weapon.a', { id: 'weapon.sword' }).id).toBe('declared.weapon.a');
  const byDeclared = kit([{ id: 'declared.weapon.bow', row: { id: 'weapon.bow-row' } }]);
  expect(kitWeaponOf(byDeclared, 'weapon.b', { id: 'weapon.bow' }).id).toBe('declared.weapon.bow');
});

test('a weapon the kit lacks still refuses', () => {
  expect(() => kitWeaponOf(kit([]), 'weapon.c', { id: 'weapon.sword' })).toThrow('Item effect weapon weapon.c is not in the kit');
});

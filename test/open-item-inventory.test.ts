import { afterEach, beforeEach, expect, test } from 'vitest';
import { Inventory } from '../src/client/game/Inventory';
import { ITEMS, isItemId, registerItemRow } from '../src/shared/game/bag/itemCatalog';
import { inventorySave } from '../src/shared/game/saves';
import { installShards } from '../src/client/game/shard/list';
import { installTitleManifests } from '../src/client/game/shard/titleList';

const owners: (() => void)[] = [];
beforeEach(() => { installShards([]); installTitleManifests([]); });
function item(id: string, label = 'Moon trophy'): () => void {
  const dispose = registerItemRow({ id, label, icon: 'antlers', travels: true });
  owners.push(dispose); return dispose;
}
afterEach(() => { for (const dispose of owners.splice(0).reverse()) dispose(); });

test('an authored trophy enters the real pack, persists and mirrors without a fixed item list', () => {
  item('moon.trophy');
  const pack = new Inventory('open-items');
  expect(pack.add('moon.trophy', 2)).toBe(true);
  expect(pack.items).toEqual([{ id: 'moon.trophy', count: 2, label: 'Moon trophy', icon: 'antlers', travels: true }]);
  expect(new Inventory('open-items').count('moon.trophy')).toBe(2);
  pack.mirror(new Map([['moon.trophy', 5]]));
  expect(pack.count('moon.trophy')).toBe(5);
  expect(pack.checkpoint()).toBe(true);
  expect(new Inventory('open-items').items).toEqual(pack.items);
  expect(pack.takeTravel(new Map())).toEqual([{ id: 'moon.trophy', count: 5 }]);
  expect(new Inventory('open-items').total).toBe(0);
});

test('unknown, inherited and malformed stacks cannot enter by add, mirror or save', () => {
  item('moon.trophy'); item('sun.trophy');
  const pack = new Inventory('open-items');
  for (const id of ['missing.trophy', '__proto__', 'constructor', 'toString']) {
    expect(isItemId(id)).toBe(false); expect(pack.add(id)).toBe(false); expect(pack.count(id)).toBe(0);
  }
  for (const n of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(pack.add('moon.trophy', n)).toBe(false);
  pack.mirror(new Map([['moon.trophy', 3], ['sun.trophy', -1], ['missing.trophy', 4], ['__proto__', 2], ['constructor', 2]]));
  expect(pack.items.map(row => [row.id, row.count])).toEqual([['moon.trophy', 3]]);
  expect(inventorySave.write({ counts: { 'moon.trophy': 2, 'sun.trophy': -2, 'missing.trophy': 4 }, order: ['moon.trophy', 'moon.trophy', 'sun.trophy', 'missing.trophy', 'toString'] }, 'open-items')).toBe(true);
  expect(new Inventory('open-items').items.map(row => [row.id, row.count])).toEqual([['moon.trophy', 2]]);
  expect(Object.getPrototypeOf(ITEMS)).toBeNull();
  for (const id of ['__proto__', 'constructor', 'toString']) expect(() => item(id)).toThrow('Reserved item identity');
});

test('scope disposal restores active owners and never resurrects an already disposed owner', () => {
  const base = item('moon.trophy', 'Base'), middle = item('moon.trophy', 'Middle'), top = item('moon.trophy', 'Top');
  const pack = new Inventory('open-items'); pack.add('moon.trophy');
  middle(); expect(pack.items[0]?.label).toBe('Top');
  top(); expect(pack.items[0]?.label).toBe('Base');
  top(); expect(pack.items[0]?.label).toBe('Base');
  base(); expect(isItemId('moon.trophy')).toBe(false); expect(pack.items).toEqual([]); expect(pack.total).toBe(0);
  const restored = item('moon.trophy', 'Later'); expect(pack.items[0]?.label).toBe('Later');
  restored(); expect(isItemId('moon.trophy')).toBe(false);
});

// @vitest-environment node
// A held tool's fuel and light are the server's (`targets.itemFields`, SS-GF1a1b's lantern pickups): a one-shard page mirrors
// the owner's owned lines onto the held item each frame (`client.ts`), and a grid data cell's kit (`dataCellKit.ts`) never did,
// so on the grid a lantern's fuel and light followed only the page's own guess. Both now take one mirror.
import { expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { itemLineMirror } from './itemLines';

const source = { targets: { interactions: [], panels: [], itemFields: [{ item: 'tool.lantern', fieldId: 3, property: 'fuel' }, { item: 'tool.lantern', fieldId: 4, property: 'lit' }, { item: 'tool.lantern', fieldId: 5, property: 'taken' }] },
  state: { shared: [], player: [{ id: 3, name: 'lantern.fuel', privacy: 'owner' }, { id: 4, name: 'lantern.lit', privacy: 'owner' }, { id: 5, name: 'lantern.taken', privacy: 'owner' }] } } as unknown as Pick<Shardfile, 'targets' | 'state'>;

function lantern(): { state: { fuel: number; lit: boolean; tick: number }; snapshot: () => { fuel: number; lit: boolean; tick: number }; restore: (state: { fuel: number; lit: boolean; tick: number }) => void } {
  const item = { state: { fuel: 1, lit: false, tick: 7 }, snapshot: () => ({ ...item.state }), restore: (state: { fuel: number; lit: boolean; tick: number }) => { item.state = { ...state }; } };
  return item;
}

test('a held tool takes its fuel and light from the owner\'s lines, and a line at zero is the server\'s zero', () => {
  const item = lantern(), lines = new Map<string, number>([['lantern.fuel', 0.4], ['lantern.lit', 1]]);
  const mirror = itemLineMirror(source, new Map([['tool.lantern', item]]), name => lines.get(name) ?? 0);
  if (mirror === null) throw new Error('Missing lantern mirror');
  mirror();
  expect(item.state).toEqual({ fuel: 0.4, lit: true, tick: 7 });
  lines.delete('lantern.fuel'); mirror(); // burnt out: the line is dropped from `owned`
  expect(item.state).toEqual({ fuel: 0, lit: false, tick: 7 });
  lines.set('lantern.fuel', 3); lines.set('lantern.lit', 1); mirror(); // fuel is a share
  expect(item.state.fuel).toBe(1);
});

test('no mirror for a source with no fuel or light, or an item it does not hold', () => {
  expect(itemLineMirror({ ...source, targets: { ...source.targets, itemFields: [] } }, new Map([['tool.lantern', lantern()]]), () => 0)).toBeNull();
  expect(itemLineMirror(source, new Map(), () => 0)).toBeNull();
});

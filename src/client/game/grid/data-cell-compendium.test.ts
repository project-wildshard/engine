// @vitest-environment happy-dom
// SHARD-SOURCE SS-GP4d: a grid data cell's compendium and journal. A one-shard page registers its declared compendium rows
// and installs the journal (`client.ts`, `installCompendium`); a grid copy had none, so the Template's grey blob page never
// filled on a grid cell. While the feet stand in the copy its compendium is registered, its journal and the Bag's FINDS row
// are on the page and its tracker runs on a frame system bound to the stay; all of it leaves with the stay.
import { afterEach, expect, test } from 'vitest';
import { PerspectiveCamera } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { compendiumFor, registerCompendium } from '../../../shared/game/compendium/registry';
import type { ShardCompendium } from '../../../shared/game/compendium/types';
import { BagMenu, bagMenu } from '../bag/tabs';
import type { ShardContext } from '../plugin/context';
import { hasCompendium, installCellCompendium, type DataCellCompendiumPorts } from './dataCellCompendium';

const definition: ShardCompendium = { chunkId: 'fixture-copy',
  skin: { className: 'template', title: 'Field notes', tabs: [{ id: 'beasts', label: 'Beasts' }], stamp: () => 'Taken', stats: () => [] },
  entries: [{ id: 'greyBlob', kind: 'species', tab: 'beasts', name: 'Grey blob', notes: 'Reach the hut, then defeat the grey blob.', plate: { sketch: '/blob.webp' } }] };

afterEach(() => { document.body.replaceChildren(); });

test('a copy\'s compendium is registered and its journal on the page while entered, and both leave with the stay', async () => {
  const source = { identity: { slug: 'fixture-copy', revision: 1 }, rows: { compendiums: [{ id: 'template', entries: [] }] } } as unknown as Shardfile;
  expect(hasCompendium(source)).toBe(true);
  expect(hasCompendium({ rows: { compendiums: [] } } as unknown as Shardfile)).toBe(false);
  const menuScope = new Scope('menu');
  const menu = { scope: menuScope, isOpen: false, refresh: () => undefined, close: () => undefined, addTab: () => () => undefined, addTabFragment: () => () => undefined };
  const bag = new BagMenu(menu, { inventory: { slots: 0 }, progress: { rows: [] } } as unknown as ConstructorParameters<typeof BagMenu>[1]);
  expect(bagMenu(menu)).toBe(bag);
  const stay = new Scope('grid.data-compendium.fixture'), frames: string[] = [];
  const at = { scope: stay, product: {}, rows: { compendium: (row: ShardCompendium) => { stay.onDispose(registerCompendium(row)); } } } as unknown as ShardContext;
  const ports = { camera: new PerspectiveCamera(), hud: { entered: true, toast: () => undefined }, menu, animals: { animals: [] },
    weapons: { setEnabled: () => undefined }, touchUi: () => false, nolock: true,
    game: { onUpdate: (_run: unknown, label?: string) => { frames.push(label ?? ''); } } } as unknown as DataCellCompendiumPorts;
  const installed = await installCellCompendium(source, new Map(), at, ports, () => definition); // the folder's row, built
  expect(installed).not.toBeNull();
  expect(compendiumFor('fixture-copy')?.entries[0]?.name).toBe('Grey blob');
  expect(frames).toEqual(['engine.compendium.installCompendium']);
  expect(() => bag.addFinds('compendium', () => ({ sections: [] }) as never)).toThrow(); // the copy's FINDS row is in
  stay.dispose();
  expect(compendiumFor('fixture-copy')).toBeUndefined();
  expect(installed?.journal.scope.disposed).toBe(true);
  bag.addFinds('compendium', () => ({ sections: [] }) as never)(); // the copy's FINDS row left with the stay
  menuScope.dispose();
});

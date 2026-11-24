// @vitest-environment happy-dom
// SHARD-SOURCE SS-GP4e: a grid data cell's gear loot. A one-shard page whose loot row carries gear installs its purse, coin
// burst, coin chip and the Bag's loot row (`client.ts`, `installLoot`); a grid copy had none, so the coins the cell server paid
// on a grid cell never showed. While the feet stand in the copy its purse, chip and Bag row are on the page, read from the
// copy's own folder, and leave with the stay.
import { afterEach, expect, test } from 'vitest';
import { BoxGeometry, Scene, PerspectiveCamera, Vector3 } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Owned } from '../../../shared/game/loot/Owned';
import { BagMenu, bagMenu } from '../bag/tabs';
import { installCoinModel } from '../loot/coinModel';
import type { ShardContext } from '../plugin/context';
import { cellLootRow, installCellLoot } from './dataCellLoot';

// the Template's built `economy/loot` row (sdk 0.4.8, `new`), with the currency FP31 makes a purse need
const row = { charted: false, chime: 'cue.swap', finds: null, gear: 'purse.coins', id: 'template.loot', marks: null,
  economy: { currency: { id: 'coin', name: 'Coin', model: 'shared/doubloon', icon: 'coin' } } };
const source = { identity: { slug: 'fixture-copy', revision: 1 }, rows: { loot: [row] } } as unknown as Shardfile;

afterEach(() => { document.body.replaceChildren(); });

test('which copies have gear loot on a grid stay', () => {
  expect(cellLootRow(source)).toBe('template.loot');
  expect(cellLootRow({ rows: { loot: [] } } as unknown as Shardfile)).toBeNull();
  expect(cellLootRow({ rows: { loot: [{ id: 'drops', table: [] }] } } as unknown as Shardfile)).toBeNull(); // no gear: no page presentation
});

test('a copy\'s purse, coin chip and Bag row are on the page while entered and leave with the stay', async () => {
  installCoinModel(() => new BoxGeometry()); // the composition root's coin recipe
  const menuScope = new Scope('menu');
  const menu = { scope: menuScope, isOpen: false, refresh: () => undefined, close: () => undefined, addTab: () => () => undefined, addTabFragment: () => () => undefined };
  const bag = new BagMenu(menu, { inventory: { slots: 0 }, progress: { rows: [] } } as unknown as ConstructorParameters<typeof BagMenu>[1]);
  expect(bagMenu(menu)).toBe(bag);
  const stay = new Scope('grid.data-loot.fixture'), systems: SystemSpec[] = [], chimes: string[] = [];
  const ctx = { scope: stay, system: (spec: SystemSpec) => { systems.push(spec); }, debug: { expose: () => undefined },
    product: { section: () => ({ rows: { loot: [row] } }) },
    game: { runtime: { play: { cues: { cue: (id: string) => { chimes.push(id); return true; } } } } } } as unknown as ShardContext;
  const loot = await installCellLoot(source, 'template.loot', ctx, { owned: new Owned('fixture-copy', { read: () => ({}), write: () => undefined } as never),
    scene: new Scene(), player: { position: new Vector3() }, camera: new PerspectiveCamera(), animals: () => [], menu: menu as never });
  expect(loot?.purse).not.toBeNull();
  expect(systems.map(spec => spec.id)).toEqual(['game.loot']);
  expect(() => bagMenu(menu).addLoot('loot', { gear: () => null, finds: null, wear: () => undefined })).toThrow(/Duplicate Bag loot/u); // the copy's row is in
  const chips = document.body.childElementCount;
  expect(chips).toBeGreaterThan(0); // the coin chip
  stay.dispose();
  expect(document.body.childElementCount).toBeLessThan(chips);
  const off = bagMenu(menu).addLoot('loot', { gear: () => null, finds: null, wear: () => undefined }); // the copy's row left with the stay
  off(); menuScope.dispose();
});

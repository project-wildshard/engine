import { expect, test } from 'vitest';
import { ShardfileClient } from '../src/client/game/shardfile/client';
import { emptyShardfile } from '../src/shared/host/author';

// meta QA 11-24 row 45: a page with no client plan (proof-stranger) never registered its own items, so its wolves' declared
// hide was no item the page knew (`harvestOf` filters by `isItemId`): a felled wolf showed no [E] Harvest and paid nothing
test('a planless page registers its own items in its kit stage', () => {
  const source = emptyShardfile({ slug: 'planless', name: 'Planless', author: 'Test', seed: 1, revision: 1 });
  const page = new ShardfileClient(source, { releaseTransport: () => undefined } as never, {
    instance: 'planless', recipes: new Map(), items: new Map(), catalogue: [], voices: () => new Map(),
    icon: () => { throw new Error('No fixture items'); } } as never);
  expect(Reflect.get(page, 'mode')).toBe('full');
  const hide = { id: 'planless-wolf-hide', label: 'Wolf hide', icon: 'hide', travels: true }, registered: unknown[] = [];
  const rows = new Proxy({}, { get: (_target, name) => name === 'item' ? (list: unknown) => { registered.push(list); } : () => undefined });
  // the rest of the kit stage (creatures, compendiums, loot) answers anything: only the item rows are read here
  const any = (): unknown => new Proxy(() => undefined, { get: (_target, name) => name === Symbol.iterator ? [][Symbol.iterator] : any(), apply: () => any(), set: () => true });
  const ctx = { rows, scope: { onDispose: () => undefined }, app: any(), game: { runtime: { world: any(), hooks: {} } },
    product: { has: (name: string) => name === 'combat/items', section: () => ({ items: { catalogue: [hide] } }) } };
  Reflect.set(page, 'presentation', { materials: new Map() });
  (Reflect.get(page, 'kitData') as (ctx: unknown) => void).call(page, ctx);
  expect(registered).toEqual([[hide]]);
});

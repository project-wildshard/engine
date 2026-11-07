import { afterEach, beforeEach, expect, test } from 'vitest';
import { installTitleManifests, type TitleManifest } from '../src/client/game/shard/titleList';
import { bootCatalogue, bootCases } from '../scripts/parity/boot-smoke.mjs';

const titleSlot = Symbol.for('game.titleManifests'), worldSlot = Symbol.for('game.shards');
const saved = new Map<symbol, PropertyDescriptor | undefined>();
beforeEach(() => {
  for (const slot of [titleSlot, worldSlot]) {
    saved.set(slot, Object.getOwnPropertyDescriptor(globalThis, slot));
    Reflect.deleteProperty(globalThis, slot);
  }
});
afterEach(() => {
  for (const [slot, descriptor] of saved) {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, slot);
    else Object.defineProperty(globalThis, slot, descriptor);
  }
  saved.clear();
});

test('cold title installation supplies every smoke case without preparing any world', () => {
  const metadata = { name: 'Fixture', biome: 'Fixture',
    card: { thumb: '/card.webp', portrait: '/card.webp', landscape: '/card.webp' }};
  const rows: readonly TitleManifest[] = [
    { ...metadata, slug: 'driftwood-isle', status: 'live' },
    { ...metadata, slug: 'nine-dragon-stack', status: 'experimental' },
    { ...metadata, slug: 'sunscar-dunes', status: 'experimental' },
    { ...metadata, slug: '_template', status: 'hidden' },
    { ...metadata, slug: 'open-plot-alien-plain', status: 'hidden', shardSelect: false },
  ];
  Object.defineProperty(globalThis, worldSlot, { configurable: true, get() { throw new Error('Prepared worlds must not be read'); } });
  installTitleManifests(rows);
  expect(Reflect.get(globalThis, titleSlot)).toBe(rows);
  expect(bootCatalogue()).toEqual(rows.map(({ slug, status, shardSelect }) => ({ slug, status, legacy: false, shardSelect: shardSelect !== false })));
  expect(bootCases(bootCatalogue()).map(row => row[1])).toEqual([
    'driftwood-isle', 'nine-dragon-stack', 'nine-dragon-stack', 'sunscar-dunes', '_template', 'driftwood-isle',
  ]);
});

test('historical full discovery remains readable, but invalid current metadata refuses', () => {
  Reflect.set(globalThis, worldSlot, [{ slug: 'original', status: 'live' }]);
  expect(bootCatalogue()).toEqual([{ slug: 'original', status: 'live', legacy: false, shardSelect: true }]);
  for (const invalid of [null, [], [{ slug: 'broken' }], [{ slug: 'broken', status: 'live', shardSelect: 'false' }]]) {
    Reflect.set(globalThis, titleSlot, invalid);
    expect(() => bootCatalogue()).toThrow(/Missing built title shard catalogue|Invalid built title shard catalogue row/u);
  }
  Reflect.deleteProperty(globalThis, titleSlot);
  Reflect.deleteProperty(globalThis, worldSlot);
  expect(() => bootCatalogue()).toThrow('Missing built title shard catalogue');
});

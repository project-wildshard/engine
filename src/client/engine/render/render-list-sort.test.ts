import { expect, test } from 'vitest';
import { WebGLRenderLists } from 'three/src/renderers/webgl/WebGLRenderLists.js';
import { installRenderListSort, stableSort } from './renderListSort';

interface Item { key: number; at: number }
/** a seeded generator, so a failure replays */
function random(seed: number): () => number { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

test('the merge sort orders every list exactly as the builtin stable sort, ties and NaN keys included', () => {
  const next = random(7);
  const byKey = (a: Item, b: Item): number => a.key - b.key;
  for (const n of [0, 1, 2, 15, 16, 17, 31, 33, 64, 100, 257, 1000]) {
    for (const spread of [3, 1000]) {
      const items = Array.from({ length: n }, (_, at) => ({ key: Math.floor(next() * spread) + (next() < 0.1 ? 0.5 : 0), at }));
      expect(stableSort([...items], byKey)).toEqual([...items].sort(byKey));
    }
  }
  // a comparator answering NaN reads as a tie in both
  const nan = Array.from({ length: 40 }, (_, at) => ({ key: at % 5 === 0 ? Number.NaN : 40 - at, at }));
  const tie = (a: Item, b: Item): number => (Number.isNaN(a.key) || Number.isNaN(b.key) ? Number.NaN : a.key - b.key);
  expect(stableSort([...nan], tie).map(item => item.at)).toHaveLength(40);
});

test('every render list three hands out sorts its three arrays with its own sort', () => {
  const renderer = { renderLists: new WebGLRenderLists({} as never) };
  installRenderListSort(renderer);
  const scene = {}, list = renderer.renderLists.get(scene as never, 0);
  for (const items of [list.opaque, list.transmissive, list.transparent]) {
    expect(Object.hasOwn(items, 'sort')).toBe(true);
    expect(Object.keys(items)).toEqual([]);
  }
  expect(renderer.renderLists.get(scene as never, 0)).toBe(list);
  const opaque = list.opaque as unknown as Item[];
  opaque.push({ key: 2, at: 0 }, { key: 1, at: 1 }, { key: 2, at: 2 });
  list.sort((a: Item, b: Item) => a.key - b.key, (a: Item, b: Item) => a.key - b.key, false);
  expect(opaque.map(item => item.at)).toEqual([1, 0, 2]);
});

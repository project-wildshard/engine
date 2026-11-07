import { afterEach, expect, test } from 'vitest';
import { pageModeBoot, pageModeKtx2, type PageBootRows, type PageKtx2Rows } from './pageBoot';
import { currentPageMode, setPageMode } from '../../../shared/game/grid/pageMode';

const before = currentPageMode();
afterEach(() => setPageMode(before));
function variant(url: string): PageBootRows['shard'] {
  const groups = { sky: [url, url], baked: [], terrain: ['/ground'], trees: [], physics: [], cabins: [], props: [], art: [], music: [], sfx: [] };
  return { modes: { phone: { img: groups, ktx2: { ...groups, sky: [`${url}.ktx2`] } },
    desktop: { img: { ...groups, sky: [`${url}.desktop`] }, ktx2: groups } } };
}
const data: PageBootRows = { shard: variant('/normal'), grid: variant('/trimmed'), bakedUnreadPrefixes: ['fur-'] };
const gpu: PageKtx2Rows = { shard: { phone: { '/normal': '/normal.ktx2' }, desktop: {} },
  grid: { phone: { '/normal': '/trimmed.ktx2' }, desktop: {} } };

test('one installed binding follows page changes without reordering or deduplicating files', () => {
  const boot = pageModeBoot(data);
  if (typeof boot.sources !== 'function' || typeof boot.files !== 'function') throw new Error('Missing selectors');
  for (const mode of ['shard', 'grid', 'shard'] as const) {
    setPageMode(mode);
    for (const tier of ['phone', 'desktop'] as const) {
      expect(boot.files(tier)).toEqual(Object.values(data[mode].modes[tier].img).flat());
      for (const tex of ['img', 'ktx2'] as const) expect(boot.sources(tier, tex)).toEqual(data[mode].modes[tier][tex]);
    }
    expect(pageModeKtx2(gpu).GPU_FILES).toEqual(gpu[mode]);
  }
});

test('baked exclusions match file basenames without matching a directory or another prefix', () => {
  const boot = pageModeBoot(data);
  for (const path of ['/assets/fur-brown', '/a/fur-']) expect(boot.bakedUnread?.test(path)).toBe(true);
  for (const path of ['/assets/fur-brown/child', '/assets/not-fur-brown', '/assets/fur']) expect(boot.bakedUnread?.test(path)).toBe(false);
});

test('admission refuses missing modes, executable rows and unused options', () => {
  expect(() => pageModeBoot({ ...data, shard: undefined })).toThrow();
  expect(() => pageModeBoot({ ...data, recipe: [] })).toThrow();
  expect(() => pageModeBoot({ ...data, grid: { modes: { phone: data.grid.modes.phone } } })).toThrow();
  expect(() => pageModeBoot({ ...data, bakedUnreadPrefixes: ['.*'] })).toThrow();
  expect(() => pageModeKtx2({ ...gpu, grid: { phone: {} } })).toThrow();
  expect(() => pageModeBoot({ ...data, shard: () => data.shard })).toThrow('JSON rows');
  let reads = 0;
  expect(() => pageModeBoot({ ...data, get grid() { reads++; return data.grid; } })).toThrow('JSON rows');
  expect(reads).toBe(0);
});

import { expect, test } from 'vitest';
import { useOwnedGridHome } from './pageShell';

test('a compiled grid home needs its declared product; admitted data keeps its existing path', () => {
  const compiled = { slug: 'pine-hollow' as const, clientPlanRuntime: true as const, gridShardfile: 'fixture/shard.json' };
  expect(useOwnedGridHome('grid', compiled)).toBe(true);
  expect(useOwnedGridHome('grid', { slug: 'brasscap-mesa' }, { runtime: null })).toBe(true);
  expect(() => useOwnedGridHome('grid', { slug: 'pine-hollow', clientPlanRuntime: true })).toThrow('cannot be an owned region');
  expect(() => useOwnedGridHome('grid', { slug: 'pine-hollow' })).toThrow('cannot be an owned region');
});

test('native source flags grant no grid ownership and standalone legacy selection stays outside the grid', () => {
  // a native-runtime source under any slug (LD6 retired the last frozen copy's)
  const legacy = { slug: 'far-reach' as const, gridShardfile: 'fixture/shard.json',
    nativeRuntime: { slug: 'far-reach', entry: 'runtime/index.ts' } };
  expect(() => useOwnedGridHome('grid', legacy)).toThrow('no admitted data or compiled client page');
  // LD9: a source runtime entry can no longer be declared at all; a source without a declared runtime still refuses
  expect(() => useOwnedGridHome('grid', legacy, {})).toThrow('cannot be an owned region');
  expect(useOwnedGridHome('shard', legacy)).toBe(false);
});

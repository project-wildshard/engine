import { expect, test } from 'vitest';
import { installShards, shards } from '../src/client/game/shard/list';
import { findShard } from '../src/client/game/shard/registry';
import { installCatalogueFixture } from './fixtures/bootSetup';

await installCatalogueFixture();

test('prefetch lookups retain live manifests across replacement and reinstallation', () => {
  const previous = shards(), original = previous[0];
  if (original === undefined) throw new Error('Missing installed manifest');
  const first = { ...original, slug: '_template' as const, shardfile: '/first.json' };
  const second = { ...first, shardfile: '/second.json' }, firstList = [first], secondList = [second];
  try {
    installShards(firstList);
    for (let tick = 0; tick < 60; tick++) expect(findShard(first.slug)).toBe(first);
    for (const missing of ['absent', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) expect(findShard(missing)).toBeUndefined();
    first.shardfile = '/updated.json';
    expect(findShard(first.slug)?.shardfile).toBe('/updated.json');
    installShards(secondList);
    expect(findShard(first.slug)).toBe(second);
    installShards(firstList);
    expect(findShard(first.slug)).toBe(first);
    expect(findShard(first.slug)?.shardfile).toBe('/updated.json');
    installShards([first, second]);
    expect(findShard(first.slug)).toBe(second);
    installShards([]);
    expect(findShard(first.slug)).toBeUndefined();
  } finally { installShards(previous); }
});

test('all installed slugs resolve to the original manifests', () => {
  const installed = shards(), expected = new Map(installed.map(manifest => [manifest.slug, manifest]));
  for (const manifest of installed) expect(findShard(manifest.slug)).toBe(expected.get(manifest.slug));
});

test('reentrant slug reads retain the captured lookup and the current installed list', () => {
  const previous = shards(), original = previous[0];
  if (original === undefined) throw new Error('Missing installed manifest');
  const nested = { ...original, slug: '_template' as const }, nestedList = [nested];
  let armed = false;
  const outer = { ...nested, get slug() {
    if (armed) {
      armed = false;
      installShards(nestedList);
      expect(findShard(nested.slug)).toBe(nested);
    }
    return nested.slug;
  } };
  try {
    installShards([outer]); armed = true;
    expect(findShard('_template')).toBe(outer);
    expect(findShard('_template')).toBe(nested);
  } finally { installShards(previous); }
});

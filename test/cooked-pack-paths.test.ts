import { expect, test } from 'vitest';
import { COOKED_ORIGIN, cookedIndexKey, cookedObjectKey, cookedShardPrefix, cookedVersionPrefix, readCookedIndexAddress } from '../src/shared/game/shardfile/cookedPackPaths';

const ref = { slug: 'driftwood-isle', shardVersion: '0.2.13', cookVersion: '1.0.0', cookHash: 'a'.repeat(64) };

test('a cooked index is addressed by the raw shard version and cook identity', () => {
  expect(new URL(cookedIndexKey(ref), COOKED_ORIGIN).href).toBe(
    `https://cooked.wildshard.io/shards/driftwood-isle/0.2.13/cooks/1.0.0/${ref.cookHash}/index.json`,
  );
  expect(() => cookedIndexKey({ ...ref, shardVersion: '13' })).toThrow('Invalid cooked shard identity');
  expect(() => cookedIndexKey({ ...ref, cookHash: '../preview' })).toThrow('Invalid cook hash');
});

test('paths resolve only to objects in the named shard version and cook', () => {
  const image = `${cookedShardPrefix(ref)}common/${'b'.repeat(64)}.png`;
  const map = `${cookedVersionPrefix(ref)}shardfiles/driftwood-isle/map.png`;
  const objects = { 'assets/driftwood-isle/image.png': image, 'shardfiles/driftwood-isle/map.png': map };
  expect(cookedObjectKey(ref, objects, '/assets/driftwood-isle/image.png?v=1234')).toBe(image);
  expect(cookedObjectKey(ref, objects, '/shardfiles/driftwood-isle/map.png')).toBe(map);
  expect(cookedObjectKey(ref, objects, '/absent')).toBeUndefined();
  expect(() => cookedObjectKey({ ...ref, cookVersion: '2.0.0' }, objects, 'shardfiles/driftwood-isle/map.png')).toThrow('outside its shard version');
});

test('the index address and mount both resolve the same version-owned object', () => {
  const path = 'assets/driftwood-isle/image.png';
  const key = `${cookedShardPrefix(ref)}common/${'b'.repeat(64)}.png`;
  const address = {...ref, hash: 'c'.repeat(64), objects: {[path]: key}, mounts: {[`/${path}`]: key}};
  expect(readCookedIndexAddress(address)).toEqual(address);
  expect(() => readCookedIndexAddress({...address, mounts: {[`/${path}`]: 'wrong'}})).toThrow('Invalid cook mount');
});

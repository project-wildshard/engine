import { expect, test } from 'vitest';
import { memoryAttribution } from './memoryAttribution';
import { adoptBuffer, ownedArray, ownedBuffer, ownedCopy, releaseOwned } from './ownedBuffer';

const ram = (kind: string): number => memoryAttribution.kinds('ram')[kind] ?? 0;

test('every helper buffer is counted once under its owner and kind, whatever its size, until released', () => {
  const before = { geometry: ram('geometry-cpu'), plain: ram('array-buffer'), wire: ram('wire') };
  const small = ownedArray(Float32Array, 10, { owner: 'test/a', kind: 'geometry-cpu' });
  const big = ownedBuffer(1 << 20, { owner: 'test/b' });
  const copy = ownedCopy(new Uint16Array(4096).subarray(0, 100), { owner: 'test/c', kind: 'wire' });
  const fetched = adoptBuffer(new Uint8Array(new ArrayBuffer(2048)), { owner: 'test/d', kind: 'wire' });
  expect(copy.length).toBe(100); expect(copy.buffer.byteLength).toBe(200);
  expect(ram('geometry-cpu') - before.geometry).toBe(40);
  expect(ram('array-buffer') - before.plain).toBe(1 << 20);
  expect(ram('wire') - before.wire).toBe(200 + 2048);
  expect(memoryAttribution.ownerOf(small.buffer, 'ram')).toBe('test/a');
  expect(memoryAttribution.ownerOf(fetched.buffer, 'ram')).toBe('test/d');
  // a second holder's view is the same buffer: counted once
  adoptBuffer(new Uint8Array(fetched.buffer, 0, 16), { owner: 'test/d', kind: 'wire' });
  expect(ram('wire') - before.wire).toBe(200 + 2048);
  releaseOwned(big); releaseOwned(copy);
  expect(ram('array-buffer') - before.plain).toBe(0);
  expect(ram('wire') - before.wire).toBe(2048);
  expect(memoryAttribution.ownerOf(copy.buffer, 'ram')).toBeNull();
  expect(memoryAttribution.ownerOf(new ArrayBuffer(8), 'ram')).toBeNull();
});

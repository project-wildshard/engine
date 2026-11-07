// oxlint-disable-next-line import/no-nodejs-modules -- Own all cache files used by this immutable-byte fixture regression.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Use repository tmp and the full original content hash for cache identities.
import { resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import { originalPlaceBinary } from './fixtures/nalati-original-place-binary';
import * as source from './fixtures/nalati-native-place-files';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import pins from './fixtures/nalati-place-wires.json' with { type: 'json' };

const pin = pins.find(row => row.path.endsWith('/places.bin'));
if (pin === undefined) throw new Error('Missing original Places fixture pin');
const original = pin;

test('cold and warm originals retain every byte without a warm producer call', async () => {
  const root = mkdtempSync(resolve('tmp/nalati-original-cache-')), make = vi.spyOn(source, 'nativePlaceFile');
  try {
    const first = await originalPlaceBinary(root);
    expect(first.byteLength).toBe(original.bytes); expect(hashImmutableBytes(first)).toBe(original.hash);
    expect(make).toHaveBeenCalledTimes(1);
    first.fill(0);
    const next = await originalPlaceBinary(root);
    expect(make).toHaveBeenCalledTimes(1);
    expect(next.byteLength).toBe(original.bytes); expect(hashImmutableBytes(next)).toBe(original.hash);
    expect(first.buffer).not.toBe(next.buffer);
  } finally { make.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});

test('corrupt originals refuse without invoking a replacement producer', async () => {
  const root = mkdtempSync(resolve('tmp/nalati-corrupt-cache-')), make = vi.spyOn(source, 'nativePlaceFile');
  try {
    writeFileSync(resolve(root, `${original.hash}.bin`), new Uint8Array([0]));
    await expect(originalPlaceBinary(root)).rejects.toThrow('Original Places test cache differs');
    expect(make).not.toHaveBeenCalled();
  } finally { make.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});

test('concurrent first readers publish only the complete original bank', async () => {
  const root = mkdtempSync(resolve('tmp/nalati-concurrent-cache-'));
  try {
    const bytes = await Promise.all([originalPlaceBinary(root), originalPlaceBinary(root)]);
    for (const file of bytes) { expect(file.byteLength).toBe(original.bytes); expect(hashImmutableBytes(file)).toBe(original.hash); }
    expect(bytes[0]?.buffer).not.toBe(bytes[1]?.buffer);
    expect(hashImmutableBytes(await originalPlaceBinary(root))).toBe(original.hash);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

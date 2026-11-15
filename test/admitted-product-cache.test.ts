// oxlint-disable-next-line import/no-nodejs-modules -- Fixtures own their scratch product identity.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch lives in the lane folder.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare large banks without enumerating every byte in the assertion library.
import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { createAdmittedProductCache } from './fixtures/headless/admittedProductCache';
import { builtProduct } from './fixtures/builtProduct';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { productClosureFile } from '../src/shared/game/shardfile/shardProduct';
import { shardProductData } from '../src/shared/game/shardfile/productData';

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

test('TS7: repeated borrowers share one admission and disk read, with independent complete worker banks', async () => {
  const directory = builtProduct('_template'), admitted = await loadHeadlessProduct(directory);
  const reads = vi.fn((ref: string) => productClosureFile(admitted, ref));
  const load = vi.fn(async () => shardProductData(admitted.shardfile, 'file:///fixture/', reads));
  const cached = createAdmittedProductCache(load);
  const [first, second] = await Promise.all([cached(directory, 'full'), cached(directory, 'full')]);
  expect(load).toHaveBeenCalledTimes(1);
  const inventory = outputDescriptor(admitted.shardfile)?.index.files ?? [];
  expect(first.assets.size).toBe(new Set(inventory.map(file => file.commons === true ? `commons:${file.hash}` : file.hash)).size);
  expect(reads).toHaveBeenCalledTimes(first.assets.size);
  for (const [ref, bytes] of first.assets) {
    expect(digest(second.assets.get(ref) ?? new Uint8Array())).toBe(digest(bytes));
    expect(second.assets.get(ref)).not.toBe(bytes);
    bytes.fill(0);
  }
  first.assets.clear();
  first.product.shardfile.identity.name = 'caller mutation';
  const third = await cached(directory, 'full');
  expect(third.product.shardfile.identity.name).toBe(admitted.shardfile.identity.name);
  expect([...third.assets].map(([ref, bytes]) => [ref, digest(bytes)])).toEqual([...second.assets].map(([ref, bytes]) => [ref, digest(bytes)]));
  expect(reads).toHaveBeenCalledTimes(second.assets.size);
  const named = inventory.find(file => file.name !== undefined);
  if (named?.name === undefined) throw new Error('Fixture needs a named file');
  const borrowed = await third.product.file(named.name), expected = digest(borrowed);
  borrowed.fill(0);
  expect(digest(await third.product.file(named.name))).toBe(expected);
  expect(reads).toHaveBeenCalledTimes(second.assets.size);
  await cached(directory, 'server'); await cached(directory, 'slice');
  expect(load).toHaveBeenCalledTimes(3);
});

test('TS7: changed identity and failed admission cannot reuse the previous bank', async () => {
  const directory = builtProduct('_template'), admitted = await loadHeadlessProduct(directory);
  const root = resolve('tmp/codex-wire'); mkdirSync(root, { recursive: true });
  const scratch = mkdtempSync(`${root}/product-cache-`);
  const header = readFileSync(`${directory}/shard.json`, 'utf8');
  const load = vi.fn(async () => admitted), cached = createAdmittedProductCache(load);
  try {
    writeFileSync(`${scratch}/shard.json`, header);
    await cached(scratch, 'full');
    writeFileSync(`${scratch}/shard.json`, `${header}\n`);
    await expect(cached(scratch, 'full')).rejects.toThrow('changed during cache admission');
    await expect(cached(scratch, 'full')).rejects.toThrow('changed during cache admission');
    expect(load).toHaveBeenCalledTimes(3);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

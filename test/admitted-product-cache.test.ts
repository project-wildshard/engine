// oxlint-disable-next-line import/no-nodejs-modules -- Fixtures own their scratch product identity.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch lives in the lane folder.
import { dirname, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare bank bytes without relying on assertion-library typed-array formatting.
import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { createAdmittedProductCache } from '../src/test/game/headless/admittedProductCache';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { productClosureFile } from '../src/shared/game/shardfile/shardProduct';
import { shardProductData } from '../src/shared/game/shardfile/productData';
import { emptyShardfile } from '../src/shared/host/author';
import { encodeCanonicalJson } from '../src/shared/host/immutable';
import { outputSectionPayloads } from '@wildshard/format/outputFields';
import { parseOutputIndex } from '@wildshard/format/outputIndex';

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Real disk admission and blob verification, with one server and one page file.
 * Integration journeys separately exercise complete shipped products. */
async function fixture(): Promise<{ directory: string; admitted: Awaited<ReturnType<typeof loadHeadlessProduct>> }> {
  const root = resolve('tmp/codex-wire'); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(`${root}/product-cache-`);
  try {
    const put = (path: string, bytes: Uint8Array): void => {
      const file = resolve(directory, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes);
    };
    const encode = (value: unknown): Uint8Array => new TextEncoder().encode(encodeCanonicalJson(value));
    const source = emptyShardfile({ slug: 'cache-fixture', name: 'Cache fixture', author: 'Test', revision: 1, seed: 1 });
    const sections = [...outputSectionPayloads(source)].map(([name, value]) => {
      const bytes = encode(value), path = `sections/${name}.json`; put(path, bytes);
      return { name, path, schema: `wildshard:${name}@1`, hash: digest(bytes), bytes: bytes.length };
    });
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBmkAAAAASUVORK5CYII=', 'base64'));
    const files = ([['bin', new Uint8Array([1, 2, 3]), 'server.bin'], ['image', png, 'page.png']] as const).map(([kind, bytes, name]) => {
      const hash = digest(bytes), path = `blobs/${kind}/${hash}.${kind === 'image' ? 'png' : 'bin'}`; put(path, bytes);
      return { kind, name, hash, path, compressed: bytes.length, decoded: kind === 'image' ? 4 : bytes.length,
        gpu: kind === 'image' ? 4 : 0, triangles: 0, draws: 0, dependencies: [], critical: false };
    });
    source.library = files.map(file => file.hash);
    source.budgets.library = { resident: files.reduce((sum, file) => sum + file.decoded + file.gpu, 0),
      compressed: files.reduce((sum, file) => sum + file.compressed, 0) };
    const index = parseOutputIndex({ format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version,
      identity: source.identity, build: { sourceHash: digest(encode(source)), validator: 'test' }, requires: source.requires,
      admission: { budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps,
        critical: source.critical, library: source.library }, sections, schemas: [], files, runtime: null });
    put('shard.json', encode(index));
    return { directory, admitted: await loadHeadlessProduct(directory) };
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
}

test('TS7: repeated borrowers share one admission and disk read, with independent complete worker banks', async () => {
  const { directory, admitted } = await fixture();
  try {
    const reads = vi.fn((ref: string) => productClosureFile(admitted, ref));
    const load = vi.fn(async () => shardProductData(admitted.shardfile, 'file:///fixture/', reads));
    const cached = createAdmittedProductCache(load);
    const [first, second] = await Promise.all([cached(directory, 'full'), cached(directory, 'full')]);
    expect(load).toHaveBeenCalledTimes(1);
    const inventory = outputDescriptor(admitted.shardfile)?.index.files ?? [];
    expect(inventory.some(file => serverReadsFile(file, undefined))).toBe(true);
    expect(inventory.some(file => !serverReadsFile(file, undefined))).toBe(true);
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
    const server = await cached(directory, 'server'), slice = await cached(directory, 'slice');
    expect(server.assets.size).toBe(inventory.length);
    expect(slice.assets.size).toBe(inventory.length);
    expect(load).toHaveBeenCalledTimes(3);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('TS7: changed identity and failed admission cannot reuse the previous bank', async () => {
  const { directory: scratch, admitted } = await fixture();
  const header = readFileSync(`${scratch}/shard.json`, 'utf8');
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

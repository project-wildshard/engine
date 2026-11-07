// oxlint-disable-next-line import/no-nodejs-modules -- All product and compatibility output bytes belong to this fixture.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep both output destinations under repository scratch.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { writeImagePixels } from '../src/sharddev/bake/image';
import { packProjectMap } from '../src/sharddev/projectMap';
import { writeOutputProduct } from '../src/sharddev/outputProduct';
import { publishProductMap } from '../scripts/built-product.mjs';

test('the public map alias comes only from verified product map bytes with the current world key', async () => {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp', 'product-map-'));
  try {
    const image = await writeImagePixels({ width: 1, height: 1, pixels: new Uint8ClampedArray([1, 2, 3, 255]) });
    const { shard, hash } = packProjectMap(emptyShardfile({ slug: 'author', name: 'Author', author: 'Test', revision: 1, seed: 1 }), { bytes: image, tilesHash: 'a'.repeat(64) });
    const destination = resolve(root, 'out/author'), index = writeOutputProduct(shard, new Map([[hash, image]]), destination);
    await publishProductMap(root, 'author', destination, 'a'.repeat(64));
    expect(new Uint8Array(readFileSync(resolve(root, 'public/assets/author/map/top.webp')))).toEqual(image);
    await expect(publishProductMap(root, 'author', destination, 'b'.repeat(64))).rejects.toThrow('current world inputs');
    const file = index.files.find(row => row.hash === hash); if (file === undefined) throw new Error('Missing map image row');
    writeFileSync(resolve(destination, file.path), new Uint8Array(image.length));
    await expect(publishProductMap(root, 'author', destination, 'a'.repeat(64))).rejects.toThrow('image differs');
    writeFileSync(resolve(destination, 'validation.json'), '{}');
    await expect(publishProductMap(root, 'author', destination, 'a'.repeat(64))).rejects.toThrow('receipt differs');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

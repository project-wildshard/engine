// SF16 (J525): a texture named by hash may be a PNG or JPEG blob. The page reads the cook's KTX2 that the table names under
// the blob's URL (`#layer` for a splat layer) when it loads KTX2, and decodes the image when there is no row; a KTX2 blob,
// as every hand-made set is, reads as it did.
import { describe, expect, test, vi } from 'vitest';
import type { SplatTerrain } from '@wildshard/format/splatTerrain';
import { blobGpuFile, registerGpuFiles } from '../src/client/engine/boot/gpuFiles';
import { cookedBlobBytes, isKtx2Bytes } from '../src/client/game/shardfile/blobTextures';
import { cookedSplatBytes } from '../src/client/game/shardfile/clientSplatLayers';
import { imageBlobKeys, splatLayerFiles, splatLayerKey } from '../src/shared/engine/boot/splatLayerRows';

const hash = (c: string): string => c.repeat(64);
const KTX2 = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const table = {
  [`/shardfiles/z/blobs/image/${hash('a')}.jpg`]: `/assets/z/blobs/${hash('a')}-0123abcd.ktx2`,
  [splatLayerKey(`/shardfiles/z/blobs/image/${hash('b')}.png`)]: `/assets/z/blobs/${hash('b')}-4567cdef.ktx2`,
  [splatLayerKey(`/shardfiles/z/blobs/ktx2/${hash('c')}.ktx2`)]: `/assets/z/splat/${hash('c')}.t16384-89abcdef.ktx2`,
  '/assets/z/tex/rock/diffuse.jpg': '/assets/z/tex/rock/diffuse-00000000.ktx2',
};

describe('SF16: the table names an image blob\'s KTX2', () => {
  test('an image blob for itself, and a splat layer of either blob kind', () => {
    expect([...imageBlobKeys(table)]).toEqual([[hash('a'), `/shardfiles/z/blobs/image/${hash('a')}.jpg`]]);
    expect([...splatLayerFiles(table)]).toEqual([[hash('b'), table[splatLayerKey(`/shardfiles/z/blobs/image/${hash('b')}.png`)]], [hash('c'), table[splatLayerKey(`/shardfiles/z/blobs/ktx2/${hash('c')}.ktx2`)]]]);
  });

  test('the registered table gives a blob hash its KTX2, and nothing with KTX2 vetoed', () => {
    registerGpuFiles({ phone: table, desktop: table });
    expect(blobGpuFile(hash('a'), 'ktx2')).toBe(table[`/shardfiles/z/blobs/image/${hash('a')}.jpg`]);
    expect(blobGpuFile(hash('a'), 'img')).toBeUndefined();
    expect(blobGpuFile(hash('c'), 'ktx2')).toBeUndefined();
  });

  test('the page reads an image blob\'s row, never a KTX2 blob\'s or one with no row', async () => {
    expect(isKtx2Bytes(KTX2)).toBe(true);
    expect(isKtx2Bytes(JPEG)).toBe(false);
    const assets = new Map([[hash('a'), JPEG], [hash('d'), JPEG], [hash('e'), KTX2]]);
    const rows = new Map([[hash('a'), '/assets/z/blobs/a.ktx2'], [hash('e'), '/assets/z/blobs/e.ktx2']]);
    const read = vi.fn(async (url: string) => new TextEncoder().encode(url));
    const cooked = await cookedBlobBytes([hash('a'), hash('d'), hash('e'), hash('f')], assets, ref => rows.get(ref), read);
    expect(read.mock.calls).toEqual([['/assets/z/blobs/a.ktx2']]);
    expect([...cooked.keys()]).toEqual([hash('a')]);
  });

  test('an image splat layer\'s row is read on the desktop too; a KTX2 layer\'s only by a phone drawing the phone set', async () => {
    const layers = { colour: [hash('b'), hash('c'), hash('b'), hash('c')], normal: [hash('b'), hash('c'), hash('b'), hash('c')], arm: [hash('b'), hash('c'), hash('b'), hash('c')] } as SplatTerrain['layers'];
    const tint: [number, number, number] = [1, 1, 1];
    const splat = { material: 'ground', layers, tints: [tint, tint, tint, tint], boreal: null } as SplatTerrain;
    const rows = splatLayerFiles(table), read = vi.fn(async (url: string) => new TextEncoder().encode(url));
    const cooked = await cookedSplatBytes(splat, new Set([hash('b'), hash('c')]), 'desktop', ref => rows.get(ref), read, (ref: string) => ref === hash('b'));
    expect([...cooked.keys()]).toEqual([hash('b')]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

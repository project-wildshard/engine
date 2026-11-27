// SF20 (J525): a shardfile carries images and the cook makes their KTX2, so a tile budget counts an image as the KTX2 the
// runtime reads. A PNG and the cook's KTX2 of it count the same: resident always, download when the caller passes the cook's
// encoder (no formula stands in for Zstandard); without one the download stays the PNG's. A GLB holding a PNG moves the
// same way; a WebP, which the cook leaves alone, and an image off the 4x4 grid keep their own cost.
// oxlint-disable-next-line import/no-nodejs-modules -- a built product folder on disk.
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- a built product folder on disk.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- a built product folder on disk.
import {join} from 'node:path';
import sharp from 'sharp';
import {beforeAll, expect, it} from 'vitest';
import {assetCost} from '@wildshard/format/shardfileAssets';
import {cookedFileCost, cookedKtx2Cost, imageSize} from '../src/scripts/cooked-image-cost.mjs';
import {measuredKtx2Bytes, tileBakeCensus} from '../src/scripts/tile-bakes.mjs';
import {loadBasisuImageKtx2, type ImageKtx2Encode} from '../src/cook/game/imageKtx2Wasm';

let encode: ImageKtx2Encode;
beforeAll(async () => { encode = await loadBasisuImageKtx2(); }, 60_000);

/** Seeded noise, so Zstandard can't fold the UASTC blocks away and the bound is tested near its edge. */
const noise = (width: number, height: number): Buffer => { let seed = 7; return Buffer.from(Array.from({length: width * height * 3}, () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24)); };
const png = async (width: number, height: number): Promise<Uint8Array> => new Uint8Array(await sharp(noise(width, height), {raw: {width, height, channels: 3}}).png().toBuffer());
const row = (hash: string, kind: string, bytes: Uint8Array) => ({hash, kind, dependencies: [], compressed: bytes.length, ...assetCost(kind, bytes)});

/** One L0 tile at 0/0/0 holding `file`, its declared cost the file's own (the SDK's sum). */
const tiles = (file: ReturnType<typeof row>) => [{lod: 0, x: 0, z: 0, files: [file.hash], geometricError: 0, decoded: file.decoded, gpu: file.gpu, compressed: file.compressed, triangles: 0, draws: 0,
  bounds: {min: [-250, 0, -250], max: [-187.5, 10, -187.5]}}] as unknown as Parameters<typeof tileBakeCensus>[0];
const resident = (cost: {decoded: number; gpu: number}): number => cost.decoded + cost.gpu;
const measured = (image: Uint8Array): number | undefined => encode(image, {role: 'srgb', flip: false})?.length;

it('a PNG counts as the KTX2 the cook makes of it', async () => {
  const image = await png(96, 64), ktx2 = encode(image, {role: 'srgb', flip: false});
  if (ktx2 === undefined) throw new Error('the cook made no KTX2');
  const ownKtx2 = {...assetCost('ktx2', ktx2), compressed: ktx2.length};
  const cooked = cookedFileCost(row('a', 'image', image), image, measured), unmeasured = cookedFileCost(row('a', 'image', image), image);
  expect(cooked).toEqual({decoded: ownKtx2.decoded, gpu: ownKtx2.gpu, compressed: ownKtx2.compressed});
  expect(resident(unmeasured ?? {decoded: 0, gpu: 0})).toBe(resident(ownKtx2));
  expect(unmeasured?.compressed).toBe(image.length);
  // The bound: the levels' UASTC blocks before Zstandard are never under the file the cook writes.
  expect(cookedKtx2Cost(imageSize(image))?.compressed).toBeGreaterThanOrEqual(ktx2.length);
  expect(imageSize(image)).toEqual({width: 96, height: 64});
}, 60_000);

it('the tile census charges the cooked cost, and passes no cooked function unchanged', async () => {
  const image = await png(96, 64), file = row('a'.repeat(64), 'image', image), cooked = cookedFileCost(file, image, measured);
  if (cooked === undefined) throw new Error('no cooked cost');
  const plain = tileBakeCensus(tiles(file), [file]), charged = tileBakeCensus(tiles(file), [file], () => cooked);
  expect(plain.windows[0]?.unique.resident).toBe(resident(file));
  expect(charged.windows[0]?.unique.resident).toBe(resident(cooked));
  expect(charged.windows[0]?.declared).toEqual(charged.windows[0]?.unique);
  expect(plain.windows[0]?.declared.compressed).toBe(image.length);
  expect(charged.windows[0]?.declared.compressed).toBe(cooked.compressed);
}, 60_000);

it('a GLB holding a PNG moves by its image; a WebP and an off-grid image keep their cost', async () => {
  const image = await png(64, 64), json = new TextEncoder().encode(JSON.stringify({asset: {version: '2.0'}, buffers: [{byteLength: image.length}],
    bufferViews: [{buffer: 0, byteOffset: 0, byteLength: image.length}], images: [{bufferView: 0, mimeType: 'image/png'}]}));
  const jsonLength = Math.ceil(json.length / 4) * 4, binLength = Math.ceil(image.length / 4) * 4;
  const glb = new Uint8Array(12 + 8 + jsonLength + 8 + binLength), view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, glb.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); glb.fill(0x20, 20, 20 + jsonLength); glb.set(json, 20);
  view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true); glb.set(image, 28 + jsonLength);
  const own = {kind: 'glb', decoded: 1_000_000, gpu: 500_000, compressed: glb.length};
  const moved = cookedFileCost(own, glb, measured), ktx2 = measured(image) ?? 0;
  expect(moved?.gpu).toBe(own.gpu);
  expect(moved?.decoded).toBe(own.decoded - (64 * 64 * 4 + image.length * 4));
  expect(moved?.compressed).toBe(glb.length - image.length + ktx2);
  expect(cookedFileCost(own, glb)?.compressed).toBe(glb.length);
  const webp = new Uint8Array(await sharp(noise(64, 64), {raw: {width: 64, height: 64, channels: 3}}).webp({lossless: true}).toBuffer());
  expect(cookedFileCost(row('w', 'image', webp), webp, measured)).toBeUndefined();
  const odd = await png(66, 64);
  expect(cookedFileCost(row('o', 'image', odd), odd, measured)).toBeUndefined();
}, 60_000);

it('the census measures a built product with the cook encoder by default', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sf20-')), image = await png(64, 32);
  try {
    writeFileSync(join(folder, 'a.png'), image);
    writeFileSync(join(folder, 'shard.json'), JSON.stringify({files: [{kind: 'image', path: 'a.png'}]}));
    expect(measuredKtx2Bytes(folder)(image, {standalone: true})).toBe(measured(image));
  } finally { rmSync(folder, {recursive: true, force: true}); }
}, 120_000);

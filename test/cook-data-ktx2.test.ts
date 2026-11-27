// SF17 (J525): skin maps and posed atlases cook like other colour textures, and a data map (the ground's grain, trail and
// key shadow: Dunes' sand) cooks to a lossless single-level zstd R8 or RGBA8 KTX2 whose texels are the PNG's exactly. The
// page reads each through the table: a data map in either texture mode, a posed atlas by its URL.
// oxlint-disable-next-line import/no-nodejs-modules -- the test decodes the KTX2's zstd level as three's loader does.
import {zstdDecompressSync} from 'node:zlib';
import sharp from 'sharp';
import {beforeAll, describe, expect, it} from 'vitest';
import {blobKtx2, blobTextureUses, dataMapKey} from '../src/cook/game/blobKtx2';
import {dataKtx2, pngTexels} from '../src/cook/game/dataKtx2';
import {loadBasisuImageKtx2, type ImageKtx2Encode} from '../src/cook/game/imageKtx2Wasm';
import {ktx2Info, phoneTier} from '../src/cook/game/tierTextures';
import {cookedKtx2TableOf} from '../src/shared/game/shardfile/cookedKtx2Table';
import {blobGpuFile, registerGpuFiles} from '../src/client/engine/boot/gpuFiles';
import {posedAtlasSource} from '../src/client/game/plugin/geometry';

const hash = (at: number): string => at.toString(16).padStart(64, '0');
const noise = (count: number, seed: number): Buffer => Buffer.from(Array.from({length: count}, (_, at) => (at * 131 + seed * 17 + (at >> 5)) & 255));
const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
/** The KTX2's level 0, unsupercompressed. */
const level0 = (ktx2: Uint8Array): Uint8Array => {
  const at = Number(view(ktx2).getBigUint64(80, true)), length = Number(view(ktx2).getBigUint64(88, true));
  return new Uint8Array(zstdDecompressSync(ktx2.subarray(at, at + length)));
};
const page = (): Uint8Array => new TextEncoder().encode(JSON.stringify({version: 1, native: {ktx2: {$call: 'pageModeKtx2', args: [{shard: {phone: {}, desktop: {}}, grid: {phone: {}, desktop: {}}}]}}}));
let encode: ImageKtx2Encode, grey: Uint8Array, rgba: Uint8Array, rgb: Uint8Array, jpg: Uint8Array;
const greyTexels = noise(48 * 32, 1), rgbaTexels = noise(30 * 30 * 4, 2), rgbTexels = noise(16 * 16 * 3, 3);

beforeAll(async () => {
  encode = await loadBasisuImageKtx2();
  grey = new Uint8Array(await sharp(greyTexels, {raw: {width: 48, height: 32, channels: 1}}).toColourspace('b-w').png().toBuffer());
  rgba = new Uint8Array(await sharp(rgbaTexels, {raw: {width: 30, height: 30, channels: 4}}).png().toBuffer());
  rgb = new Uint8Array(await sharp(rgbTexels, {raw: {width: 16, height: 16, channels: 3}}).png({adaptiveFiltering: true}).toBuffer());
  jpg = new Uint8Array(await sharp(rgbTexels, {raw: {width: 16, height: 16, channels: 3}}).jpeg().toBuffer());
});

describe('SF17: a data map cooks losslessly', () => {
  it('writes an R8 or RGBA8 single-level zstd KTX2 whose texels are the PNG\'s', () => {
    const r8 = dataKtx2(grey) ?? new Uint8Array();
    expect(ktx2Info(r8)).toMatchObject({vkFormat: 9, width: 48, height: 32, levels: 1});
    expect(view(r8).getUint32(44, true)).toBe(2);
    expect(Buffer.from(level0(r8)).equals(greyTexels)).toBe(true);
    const rgba8 = dataKtx2(rgba) ?? new Uint8Array();
    expect(ktx2Info(rgba8)).toMatchObject({vkFormat: 37, width: 30, levels: 1});
    expect(Buffer.from(level0(rgba8)).equals(rgbaTexels)).toBe(true);
    // RGB gains an opaque alpha; a JPEG is never a data map
    const opaque = level0(dataKtx2(rgb) ?? new Uint8Array());
    expect([...opaque.subarray(0, 8)]).toEqual([rgbTexels[0], rgbTexels[1], rgbTexels[2], 255, rgbTexels[3], rgbTexels[4], rgbTexels[5], 255]);
    expect(pngTexels(jpg)).toBeUndefined();
  });

  it('reads the ground\'s maps as data and the skin looks\' textures as colour', () => {
    const look = {materials: {sand: {family: 'pbr', maps: {colour: hash(4)}, ground: {grain: {map: hash(1)}, trail: {map: hash(2)}, keyShadow: {map: hash(3)}}}}};
    const uses = blobTextureUses(look, null, [hash(5)]);
    for (const at of [1, 2, 3]) expect(uses.get(hash(at))).toEqual({role: 'data', layer: false});
    expect(uses.get(hash(5))).toEqual({role: 'srgb', layer: false});
  });

  it('cooks data parameters from a packed graph file losslessly, even when also used as colour', () => {
    const graph = {params: {
      noise: {type: 'texture', role: 'data', value: hash(9)},
      sharedColour: {type: 'texture', role: 'colour', value: hash(9)},
      paint: {type: 'texture', value: hash(10)},
      lent: {type: 'texture', role: 'lent'},
    }};
    const fileHash = hash(11);
    const graphBytes = new TextEncoder().encode(JSON.stringify(graph));
    const look = {materials: {storm: {family: 'graph', file: fileHash}}};
    const uses = blobTextureUses(look, null, [], ref => ref === fileHash ? graphBytes : undefined);
    const data = uses.get(hash(9)), colour = uses.get(hash(10));
    expect(data).toEqual({role: 'data', layer: false});
    expect(colour).toEqual({role: 'srgb', layer: false});
    if (data === undefined) throw new Error('Missing graph data texture use');
    const url = `/shardfiles/z/blobs/image/${hash(9)}.png`;
    const cooked = blobKtx2(page(), 'z', [{hash: hash(9), url, bytes: rgba, use: data}], encode);
    if (cooked === undefined) throw new Error('Missing cooked graph data texture');
    const file = cooked.files.get(hash(9));
    if (file === undefined) throw new Error('Missing lossless graph data file');
    const table = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(cooked.discovery)));
    expect(table.desktop[dataMapKey(url)]).toBe(file.url);
    expect(table.phone[dataMapKey(url)]).toBe(file.url);
    expect(Buffer.from(level0(file.bytes)).equals(rgbaTexels)).toBe(true);
  });

  it('names a data map under its #data key on both tiers, a skin map and an atlas under their URLs, and the phone keeps the data file', () => {
    const data = `/shardfiles/z/blobs/image/${hash(1)}.png`, coat = `/shardfiles/z/blobs/image/${hash(5)}.png`, atlas = `/shardfiles/z/blobs/image/${hash(6)}.png`;
    const cooked = blobKtx2(page(), 'z', [
      {hash: hash(1), url: data, bytes: grey, use: {role: 'data', layer: false}},
      {hash: hash(5), url: coat, bytes: grey, use: {role: 'srgb', layer: false}},
      {hash: hash(6), url: atlas, bytes: grey, use: {role: 'srgb', layer: false}},
    ], encode);
    const table = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(cooked?.discovery)));
    expect(Object.keys(table.desktop).sort()).toEqual([atlas, coat, dataMapKey(data)].sort());
    const file = cooked?.files.get(hash(1));
    expect(table.phone[dataMapKey(data)]).toBe(file?.url);
    expect(ktx2Info(cooked?.files.get(hash(5))?.bytes ?? new Uint8Array()).vkFormat).toBe(0);
    const made = new Map([...cooked?.files.values() ?? []].map(row => [row.url, row.bytes]));
    const phone = phoneTier(cooked?.discovery ?? new Uint8Array(), url => made.get(url), () => 16);
    const phoneTable = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(phone?.discovery ?? cooked?.discovery)));
    expect(phoneTable.phone[dataMapKey(data)]).toBe(file?.url);
  }, 60_000);
});

describe('SF17: the page reads them through the table', () => {
  it('reads a data map\'s file in either texture mode', () => {
    const data = `/shardfiles/z/blobs/image/${hash(7)}.png`, url = `/assets/z/blobs/${hash(7)}-0123abcd.ktx2`;
    registerGpuFiles({phone: {[dataMapKey(data)]: url}, desktop: {[dataMapKey(data)]: url}});
    expect(blobGpuFile(hash(7), 'img')).toBe(url);
    expect(blobGpuFile(hash(7), 'ktx2')).toBe(url);
  });

  it('reads a PNG posed atlas\'s cooked KTX2 by its URL, and the image with none', () => {
    const png = `/shardfiles/z/blobs/image/${hash(8)}.png`, cooked = `/assets/z/blobs/${hash(8)}-89abcdef.ktx2`;
    expect(posedAtlasSource(png, url => (url === png ? cooked : undefined))).toEqual({kind: 'ktx2', url: cooked});
    expect(posedAtlasSource(png, () => undefined)).toEqual({kind: 'image', url: png});
    expect(posedAtlasSource('/shardfiles/z/blobs/ktx2/birds.ktx2', () => 'x')).toEqual({kind: 'ktx2', url: '/shardfiles/z/blobs/ktx2/birds.ktx2'});
  });
});

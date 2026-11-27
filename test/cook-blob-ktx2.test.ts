import sharp from 'sharp';
import {beforeAll, describe, expect, it} from 'vitest';
import {blobKtx2, blobTextureUses, type TextureBlob} from '../src/cook/game/blobKtx2';
import {loadBasisuImageKtx2, type ImageKtx2Encode} from '../src/cook/game/imageKtx2Wasm';
import {loadBasisuAstc6} from '../src/cook/game/astc6Wasm';
import {ktx2Info, phoneTier, phoneTierSize, type Astc6Encode} from '../src/cook/game/tierTextures';
import {cookedKtx2TableOf} from '../src/shared/game/shardfile/cookedKtx2Table';

// SF16 (J525): a shard's textures named by hash (material maps, prop slots, splat layers) may be PNG or JPEG blobs; the cook
// encodes each with the role its use gives it, names it in the table under the blob's URL, and the phone pass makes its 6x6.

const hash = (at: number): string => at.toString(16).padStart(64, '0');
const ASTC_6X6 = new Set([165, 166]);
/** The phone trim at a test's size, so the file keeps under CI's 60 s budget (J295). */
const small = (source: string): number | undefined => (phoneTierSize(source) === undefined ? undefined : 32);
/** The KTX2 DFD's transfer function: 2 sRGB, 1 linear. */
const transferOf = (bytes: Uint8Array): number => { const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return view.getUint8(view.getUint32(48, true) + 14); };
let encode: ImageKtx2Encode, astc6: Astc6Encode, jpg: Uint8Array, png: Uint8Array;

beforeAll(async () => {
  [encode, astc6] = await Promise.all([loadBasisuImageKtx2(), loadBasisuAstc6()]);
  jpg = new Uint8Array(await sharp({create: {width: 128, height: 128, channels: 3, background: {r: 90, g: 140, b: 60}}}).jpeg().toBuffer());
  png = new Uint8Array(await sharp({create: {width: 64, height: 64, channels: 3, background: {r: 128, g: 128, b: 255}}}).png().toBuffer());
}, 60_000);

describe('SF16: texture blobs', () => {
  it('reads each blob\'s role from the rule that names it, the stricter when two do', () => {
    const look = {materials: {
      ground: {family: 'pbr', maps: {colour: hash(1), normal: hash(2), arm: hash(3)}},
      painted: {family: 'painterly', map: hash(4)},
      shared: {family: 'pbr', maps: {roughness: hash(1)}},
    }};
    const props = {splat: {material: 'splat', layers: {colour: [hash(5), hash(5), hash(5), hash(5)], normal: [hash(6), hash(6), hash(6), hash(6)], arm: [hash(7), hash(7), hash(7), hash(7)]},
      tints: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]], boreal: null}};
    const uses = blobTextureUses(look, props);
    expect(uses.get(hash(1))).toEqual({role: 'srgb', layer: false});
    expect(uses.get(hash(2))).toEqual({role: 'normal', layer: false});
    expect(uses.get(hash(3))).toEqual({role: 'linear', layer: false});
    expect(uses.get(hash(4))).toEqual({role: 'srgb', layer: false});
    expect(uses.get(hash(5))).toEqual({role: 'srgb', layer: true});
    expect(uses.get(hash(6))).toEqual({role: 'normal', layer: true});
    expect(uses.get(hash(7))).toEqual({role: 'linear', layer: true});
  });

  it('names a material map and a splat layer in both tiers, and the phone pass makes their 6x6 files', () => {
    const discovery = new TextEncoder().encode(JSON.stringify({version: 1, native: {ktx2: {$call: 'pageModeKtx2', args: [{shard: {phone: {}, desktop: {}}, grid: {phone: {}, desktop: {}}}]}}}));
    const map = `/shardfiles/z/blobs/image/${hash(1)}.jpg`, layer = `/shardfiles/z/blobs/image/${hash(6)}.png`;
    const blobs: TextureBlob[] = [
      {hash: hash(1), url: map, bytes: jpg, use: {role: 'srgb', layer: false}},
      {hash: hash(6), url: layer, bytes: png, use: {role: 'normal', layer: true}},
    ];
    const cooked = blobKtx2(discovery, 'z', blobs, encode);
    expect(cooked).toBeDefined();
    let table = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(cooked?.discovery)));
    expect(Object.keys(table.desktop).sort()).toEqual([map, `${layer}#layer`]);
    const desktop = cooked?.files.get(hash(1))?.bytes ?? new Uint8Array();
    expect(ktx2Info(desktop)).toMatchObject({vkFormat: 0, width: 128, levels: 8});
    expect(transferOf(desktop)).toBe(2);
    expect(transferOf(cooked?.files.get(hash(6))?.bytes ?? new Uint8Array())).toBe(1);
    const made = new Map([...cooked?.files.values() ?? []].map(file => [file.url, file.bytes]));
    const phone = phoneTier(cooked?.discovery ?? new Uint8Array(), url => made.get(url), small, astc6);
    table = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(phone?.discovery)));
    const phoneMade = new Map([...phone?.files.values() ?? []].flat().map(file => [file.url, file.bytes]));
    const phoneMap = phoneMade.get(table.phone[map] ?? '') ?? new Uint8Array();
    expect(ASTC_6X6.has(ktx2Info(phoneMap).vkFormat)).toBe(true);
    expect(ktx2Info(phoneMap).width).toBe(32);
    // the splat layer is a kept row: 6x6 at its own size
    const phoneLayer = phoneMade.get(table.phone[`${layer}#layer`] ?? '') ?? new Uint8Array();
    expect(ktx2Info(phoneLayer)).toMatchObject({width: 64});
    expect(ASTC_6X6.has(ktx2Info(phoneLayer).vkFormat)).toBe(true);
  }, 60_000);

  it('makes nothing for a blob off the 4x4 grid or a document with no table', async () => {
    const odd = new Uint8Array(await sharp({create: {width: 30, height: 30, channels: 3, background: {r: 1, g: 2, b: 3}}}).png().toBuffer());
    const discovery = new TextEncoder().encode(JSON.stringify({version: 1, native: {ktx2: {$call: 'pageModeKtx2', args: [{shard: {phone: {}, desktop: {}}, grid: {phone: {}, desktop: {}}}]}}}));
    expect(blobKtx2(discovery, 'z', [{hash: hash(9), url: '/shardfiles/z/blobs/image/x.png', bytes: odd, use: {role: 'srgb', layer: false}}], encode)).toBeUndefined();
    expect(blobKtx2(new TextEncoder().encode('{"version":1,"native":{}}'), 'z', [{hash: hash(1), url: '/x.jpg', bytes: jpg, use: {role: 'srgb', layer: false}}], encode)).toBeUndefined();
  });
});

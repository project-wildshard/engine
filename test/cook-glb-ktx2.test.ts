import sharp from 'sharp';
import {beforeAll, describe, expect, it} from 'vitest';
import {desktopKtx2, glbImageRoles, ktx2Glb} from '../src/cook/game/cookedKtx2';
import {loadBasisuImageKtx2, type ImageKtx2Encode} from '../src/cook/game/imageKtx2Wasm';
import {loadBasisuAstc6} from '../src/cook/game/astc6Wasm';
import {isKtx2, ktx2Info, phoneTier, readGlb, writeGlb, type Astc6Encode, type Gltf} from '../src/cook/game/tierTextures';
import {cookedKtx2TableOf} from '../src/shared/game/shardfile/cookedKtx2Table';

// SF15 (J525): a shardfile's GLB carries PNG or JPEG images; the cook swaps each for its KTX2 (KHR_texture_basisu) with the
// role its material slot gives it, keeps every other byte, and the phone pass makes its 6x6 copy from that GLB.

let encode: ImageKtx2Encode, astc6: Astc6Encode, colour: Uint8Array, normal: Uint8Array;
const ASTC_6X6 = new Set([165, 166]);
/** The KTX2 DFD's transfer function: 2 sRGB, 1 linear. */
const transferOf = (bytes: Uint8Array): number => { const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return view.getUint8(view.getUint32(48, true) + 14); };
const POSITIONS = new Uint8Array(36).map((_, at) => at + 1);

beforeAll(async () => {
  [encode, astc6] = await Promise.all([loadBasisuImageKtx2(), loadBasisuAstc6()]);
  const paint = async (r: number, g: number, b: number, format: 'png' | 'jpeg'): Promise<Uint8Array> =>
    new Uint8Array(await sharp({create: {width: 128, height: 128, channels: 3, background: {r, g, b}}})[format]().toBuffer());
  [colour, normal] = await Promise.all([paint(200, 120, 40, 'jpeg'), paint(128, 128, 255, 'png')]);
}, 120_000);

/** A one-triangle GLB whose material samples a JPEG colour map and a PNG normal map, positions first in its buffer. */
function fixture(): Uint8Array {
  const bin = new Uint8Array(POSITIONS.length + colour.length + normal.length + 8);
  const at1 = POSITIONS.length, at2 = at1 + Math.ceil(colour.length / 4) * 4;
  bin.set(POSITIONS, 0); bin.set(colour, at1); bin.set(normal, at2);
  const json: Gltf = {
    buffers: [{byteLength: at2 + normal.length}],
    bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36}, {buffer: 0, byteOffset: at1, byteLength: colour.length}, {buffer: 0, byteOffset: at2, byteLength: normal.length}],
    accessors: [{bufferView: 0}],
    images: [{bufferView: 1, mimeType: 'image/jpeg'}, {bufferView: 2, mimeType: 'image/png'}],
    textures: [{source: 0}, {source: 1}],
    materials: [{pbrMetallicRoughness: {baseColorTexture: {index: 0}}, normalTexture: {index: 1}}],
  };
  return writeGlb(json, bin.subarray(0, at2 + normal.length));
}

describe('SF15: GLB images become KTX2', () => {
  it('gives each image its slot\'s role', () => {
    const json = readGlb(fixture())?.json;
    expect(json).toBeDefined();
    expect([...glbImageRoles(json ?? {})]).toEqual([[0, 'srgb'], [1, 'normal']]);
  });

  it('swaps PNG and JPEG for KTX2 under KHR_texture_basisu and keeps the other bytes', () => {
    const out = ktx2Glb(fixture(), encode);
    expect(out).toBeDefined();
    const glb = readGlb(out ?? new Uint8Array());
    const json = glb?.json ?? {}, bin = glb?.bin ?? new Uint8Array();
    expect(json.images?.map(image => image.mimeType)).toEqual(['image/ktx2', 'image/ktx2']);
    expect(json.textures?.map(texture => [texture.source, texture.extensions?.KHR_texture_basisu?.source])).toEqual([[undefined, 0], [undefined, 1]]);
    expect(json.extensionsUsed).toContain('KHR_texture_basisu');
    const view = (index: number): Uint8Array => { const row = json.bufferViews?.[index]; return bin.subarray(row?.byteOffset ?? 0, (row?.byteOffset ?? 0) + (row?.byteLength ?? 0)); };
    expect([...view(0)]).toEqual([...POSITIONS]);
    for (const index of [1, 2]) expect((json.bufferViews?.[index]?.byteOffset ?? 1) % 16).toBe(0);
    expect(isKtx2(view(1)) && isKtx2(view(2))).toBe(true);
    expect([transferOf(view(1)), transferOf(view(2))]).toEqual([2, 1]);
    expect(ktx2Info(view(1))).toMatchObject({vkFormat: 0, width: 128, levels: 8});
  }, 120_000);

  it('lists the cooked GLB for both tiers, and the phone pass makes its trimmed 6x6 copy', () => {
    const page = new TextEncoder().encode(JSON.stringify({version: 1, native: {}}));
    const cooked = desktopKtx2(page, [{url: '/assets/z/models/crate.glb', read: fixture}], encode);
    expect(cooked).toBeDefined();
    const table = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(cooked?.discovery)));
    const target = table.desktop['/assets/z/models/crate.glb'] ?? '';
    expect(target).toMatch(/^\/assets\/z\/models\/crate-[a-f0-9]{8}\.glb$/u);
    expect(table.phone['/assets/z/models/crate.glb']).toBe(target);
    const made = new Map(cooked?.files.map(file => [file.url, file.bytes]));
    const phone = phoneTier(cooked?.discovery ?? new Uint8Array(), url => made.get(url), () => 64, astc6);
    const phoneTable = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(phone?.discovery)));
    const phoneFile = [...phone?.files.values() ?? []].flat().find(file => file.url === phoneTable.phone['/assets/z/models/crate.glb']);
    const glb = readGlb(phoneFile?.bytes ?? new Uint8Array());
    const first = glb?.json.bufferViews?.[glb.json.images?.[0]?.bufferView ?? -1];
    const image = glb?.bin.subarray(first?.byteOffset ?? 0, (first?.byteOffset ?? 0) + (first?.byteLength ?? 0)) ?? new Uint8Array();
    expect(ASTC_6X6.has(ktx2Info(image).vkFormat)).toBe(true);
    expect(ktx2Info(image).width).toBe(64);
  }, 240_000);
});

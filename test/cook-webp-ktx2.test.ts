import sharp from 'sharp';
import {beforeAll, describe, expect, it} from 'vitest';
import {desktopKtx2, ktx2Glb} from '../src/cook/game/cookedKtx2';
import {decodeWebp, imageHead, loadBasisuImageKtx2, wasmImageKtx2, type ImageKtx2Encode} from '../src/cook/game/imageKtx2Wasm';
import {isKtx2, ktx2Info, readGlb, writeGlb, type Gltf} from '../src/cook/game/tierTextures';
import {cookedKtx2TableOf} from '../src/shared/game/shardfile/cookedKtx2Table';

// SF19: basisu reads PNG and JPEG only, and Nalati and Pine ship WebP mounts and GLBs holding WebP. The cook reads a WebP
// from a PNG of its pixels (`decodeWebp`, made ahead), so each gets its KTX2 as a PNG does; one no pass decoded stays an image.

let encode: ImageKtx2Encode, lossy: Uint8Array, lossless: Uint8Array, alpha: Uint8Array, odd: Uint8Array, pooled: Uint8Array;
const noise = (size: number, channels: number): Buffer => Buffer.from(Array.from({length: size * size * channels}, (_, at) => (at * 37 + ((at / channels) | 0) % size * 5) & 255));
const pageTable = (): Uint8Array => new TextEncoder().encode(JSON.stringify({version: 1, slug: 'z', native: {ktx2: {$call: 'pageModeKtx2', args: [{shard: {phone: {}, desktop: {}}, grid: {phone: {}, desktop: {}}}]}}}));

beforeAll(async () => {
  encode = await loadBasisuImageKtx2();
  const webp = async (size: number, channels: 3 | 4, options: {lossless?: boolean}): Promise<Uint8Array> =>
    new Uint8Array(await sharp(noise(size, channels), {raw: {width: size, height: size, channels}}).webp({quality: 90, ...options}).toBuffer());
  [lossy, lossless, alpha, odd, pooled] = await Promise.all([webp(64, 3, {}), webp(32, 3, {lossless: true}), webp(64, 4, {}), webp(30, 3, {}), webp(48, 3, {lossless: true})]);
}, 60_000);

/** A one-triangle GLB whose colour map is a WebP (`EXT_texture_webp`), as Nalati's rigged models are. */
function webpGlb(image: Uint8Array): Uint8Array {
  const positions = new Uint8Array(36).map((_, at) => at + 1), bin = new Uint8Array(36 + image.length);
  bin.set(positions, 0); bin.set(image, 36);
  const json: Gltf = {
    buffers: [{byteLength: bin.length}],
    bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36}, {buffer: 0, byteOffset: 36, byteLength: image.length}],
    accessors: [{bufferView: 0}],
    images: [{bufferView: 1, mimeType: 'image/webp'}],
    textures: [{extensions: {EXT_texture_webp: {source: 0}}}],
    materials: [{pbrMetallicRoughness: {baseColorTexture: {index: 0}}}],
    extensionsUsed: ['EXT_texture_webp'], extensionsRequired: ['EXT_texture_webp'],
  };
  return writeGlb(json, bin);
}

describe('SF19: the cook encodes WebP', () => {
  it('reads a lossy, a lossless and an extended WebP\'s size from its header', () => {
    expect(imageHead(lossy)).toEqual({kind: 'webp', width: 64, height: 64});
    expect(imageHead(lossless)).toEqual({kind: 'webp', width: 32, height: 32});
    expect(imageHead(alpha)).toEqual({kind: 'webp', width: 64, height: 64});
    expect(imageHead(new Uint8Array(40))).toBeUndefined();
  });

  it('leaves a WebP no pass decoded an image, and encodes it once decoded', async () => {
    const fresh = new Uint8Array(lossy); fresh[fresh.length - 1] = (fresh[fresh.length - 1] ?? 0) ^ 1;
    expect(encode(fresh, {role: 'srgb', flip: true})).toBeUndefined();
    expect(await decodeWebp([lossy, lossless, alpha])).toBe(true);
    for (const [image, size, levels] of [[lossy, 64, 7], [lossless, 32, 6], [alpha, 64, 7]] as const) {
      const out = encode(image, {role: 'srgb', flip: true});
      expect(out !== undefined && isKtx2(out)).toBe(true);
      expect(ktx2Info(out ?? new Uint8Array())).toMatchObject({vkFormat: 0, width: size, height: size, levels});
    }
  }, 60_000);

  it('names a WebP mount\'s KTX2 and its phone copy\'s row, and leaves one off the 4x4 grid an image', async () => {
    await decodeWebp([lossy, odd]);
    const mounts = [['/assets/z/tex/meadow.webp', lossy], ['/assets/z/tex/meadow.phone.webp', lossy], ['/assets/z/odd.webp', odd]] as const;
    const cooked = desktopKtx2(pageTable(), mounts.map(([url, bytes]) => ({url, read: () => bytes})), encode);
    const table = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(cooked?.discovery)));
    expect(table.desktop['/assets/z/tex/meadow.webp']).toMatch(/^\/assets\/z\/tex\/meadow-[a-f0-9]{8}\.ktx2$/u);
    expect(table.phone['/assets/z/tex/meadow.phone.webp']).toBe(table.desktop['/assets/z/tex/meadow.webp']);
    expect(table.desktop['/assets/z/odd.webp']).toBeUndefined();
  }, 60_000);

  it('swaps a GLB\'s WebP image for its KTX2 under KHR_texture_basisu', async () => {
    await decodeWebp([alpha]);
    const glb = readGlb(ktx2Glb(webpGlb(alpha), encode) ?? new Uint8Array());
    const json = glb?.json ?? {}, view = json.bufferViews?.[json.images?.[0]?.bufferView ?? -1];
    expect(json.images?.map(image => image.mimeType)).toEqual(['image/ktx2']);
    expect(json.textures?.[0]?.extensions).toEqual({KHR_texture_basisu: {source: 0}});
    expect(json.extensionsUsed).toContain('KHR_texture_basisu');
    const bytes = glb?.bin.subarray(view?.byteOffset ?? 0, (view?.byteOffset ?? 0) + (view?.byteLength ?? 0)) ?? new Uint8Array();
    expect(isKtx2(bytes)).toBe(true);
  }, 60_000);

  it('the worker pool encodes a WebP it recorded, as the cook\'s prepare pass runs it', async () => {
    const fresh = pooled, pool = await wasmImageKtx2({lanes: 1});
    pool.record(fresh, {role: 'srgb', flip: false});
    await pool.flush();
    const out = pool.encode(fresh, {role: 'srgb', flip: false});
    expect(out !== undefined && isKtx2(out)).toBe(true);
    expect(pool.stats.failed).toBe(0);
  }, 60_000);
});

// S12 (J330): the cook picks each texture's size per tier from one master, by dropping KTX2 mip levels above the tier's
// largest size. No re-encode: every level the phone keeps is the master's own bytes, so the look is the master's at
// any distance the phone draws.
import {describe, expect, it} from 'vitest';
import {glbImages, ktx2Info, tierGlb, trimKtx2} from '../src/cook/game/tierTextures';

const LEVEL_INDEX = 80;

/** A KTX2 with real header and index fields and stand-in level bytes (level i filled with i + 1): trimming never decodes. */
function ktx2(size: number, options: Readonly<{vkFormat?: number; scheme?: number}> = {}): Uint8Array {
  const levels = Math.log2(size) + 1, dfd = new Uint8Array(44).fill(7), kvd = new Uint8Array(20).fill(9);
  const bodies = Array.from({length: levels}, (_, level) => new Uint8Array(Math.max(16, ((size >> level) ** 2) / 4)).fill(level + 1));
  const head = LEVEL_INDEX + 24 * levels, dfdAt = head, kvdAt = dfdAt + dfd.length;
  let at = kvdAt + kvd.length;
  const offsets: number[] = [];
  for (let level = levels - 1; level >= 0; level--) { offsets[level] = at; at += bodies[level]?.length ?? 0; }
  const out = new Uint8Array(at), view = new DataView(out.buffer);
  out.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(12, options.vkFormat ?? 0, true); view.setUint32(16, 1, true);
  view.setUint32(20, size, true); view.setUint32(24, size, true); view.setUint32(36, 1, true);
  view.setUint32(40, levels, true); view.setUint32(44, options.scheme ?? 2, true);
  view.setUint32(48, dfdAt, true); view.setUint32(52, dfd.length, true); view.setUint32(56, kvdAt, true); view.setUint32(60, kvd.length, true);
  for (let level = 0; level < levels; level++) {
    const body = bodies[level] ?? new Uint8Array(), entry = LEVEL_INDEX + 24 * level;
    view.setBigUint64(entry, BigInt(offsets[level] ?? 0), true);
    view.setBigUint64(entry + 8, BigInt(body.length), true);
    view.setBigUint64(entry + 16, BigInt(body.length * 2), true);
    out.set(body, offsets[level]);
  }
  out.set(dfd, dfdAt); out.set(kvd, kvdAt);
  return out;
}

/** A GLB whose buffer holds geometry, then the image, then more geometry and a meshopt stream the trim must move. */
function glb(image: Uint8Array): Uint8Array {
  const pad = (n: number): number => Math.ceil(n / 4) * 4;
  const before = new Uint8Array(36).fill(1), after = new Uint8Array(48).fill(2), meshopt = new Uint8Array(20).fill(3);
  const imageAt = before.length, afterAt = pad(imageAt + image.length), meshoptAt = afterAt + after.length;
  const bin = new Uint8Array(pad(meshoptAt + meshopt.length));
  bin.set(before, 0); bin.set(image, imageAt); bin.set(after, afterAt); bin.set(meshopt, meshoptAt);
  const json = {
    asset: {version: '2.0'},
    extensionsUsed: ['KHR_texture_basisu', 'EXT_meshopt_compression'],
    buffers: [{byteLength: bin.length}, {byteLength: 64, extensions: {EXT_meshopt_compression: {fallback: true}}}],
    bufferViews: [
      {buffer: 0, byteOffset: 0, byteLength: before.length},
      {buffer: 0, byteOffset: imageAt, byteLength: image.length},
      {buffer: 0, byteOffset: afterAt, byteLength: after.length},
      {buffer: 1, byteLength: 64, extensions: {EXT_meshopt_compression: {buffer: 0, byteOffset: meshoptAt, byteLength: meshopt.length, byteStride: 4, count: 16, mode: 'ATTRIBUTES'}}},
    ],
    images: [{bufferView: 1, mimeType: 'image/ktx2'}],
  };
  const text = new TextEncoder().encode(JSON.stringify(json)), jsonLength = pad(text.length);
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + bin.length), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength); out.set(text, 20);
  view.setUint32(20 + jsonLength, bin.length, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(bin, 28 + jsonLength);
  return out;
}

const levelBytes = (file: Uint8Array, level: number): Uint8Array => {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength), entry = LEVEL_INDEX + 24 * level;
  const at = Number(view.getBigUint64(entry, true)), length = Number(view.getBigUint64(entry + 8, true));
  return file.subarray(at, at + length);
};

describe('S12: per-tier texture sizes from one master', () => {
  it('drops the levels above the tier size and keeps the rest byte for byte', () => {
    const master = ktx2(1024), phone = trimKtx2(master, 512);
    expect(ktx2Info(phone)).toMatchObject({width: 512, height: 512, levels: 10, scheme: 2});
    expect(phone.length).toBeLessThan(master.length * 0.3);
    for (let level = 0; level < 10; level++) expect(levelBytes(phone, level)).toEqual(levelBytes(master, level + 1));
    expect(phone.subarray(LEVEL_INDEX + 24 * 10, LEVEL_INDEX + 24 * 10 + 44)).toEqual(new Uint8Array(44).fill(7));
  });

  it('keeps a texture already at or under the size, and a BasisLZ one it cannot cut', () => {
    const small = ktx2(256), etc1s = ktx2(1024, {scheme: 1});
    expect(trimKtx2(small, 512)).toBe(small);
    expect(trimKtx2(etc1s, 512)).toBe(etc1s);
  });

  it('trims ASTC 6×6 masters too', () => {
    expect(ktx2Info(trimKtx2(ktx2(1024, {vkFormat: 166}), 512))).toMatchObject({width: 512, levels: 10, vkFormat: 166});
  });

  it('takes the images out of a GLB and puts the tier size back, with every other view moved intact', () => {
    const master = glb(ktx2(1024)), phone = tierGlb(master, 512);
    const [image] = glbImages(phone);
    expect(image).toBeDefined();
    expect(ktx2Info(image?.bytes ?? new Uint8Array())).toMatchObject({width: 512, levels: 10});
    expect(phone.length).toBeLessThan(master.length * 0.3);
    const read = (file: Uint8Array): {json: {bufferViews: {byteOffset?: number; byteLength: number; extensions?: {EXT_meshopt_compression?: {byteOffset: number; byteLength: number}}}[]}; bin: Uint8Array} => {
      const view = new DataView(file.buffer, file.byteOffset, file.byteLength), jsonLength = view.getUint32(12, true);
      return {json: JSON.parse(new TextDecoder().decode(file.subarray(20, 20 + jsonLength))), bin: file.subarray(28 + jsonLength)};
    };
    const was = read(master), now = read(phone);
    for (const index of [0, 2]) {
      const a = was.json.bufferViews[index], b = now.json.bufferViews[index];
      expect(now.bin.subarray(b?.byteOffset ?? 0, (b?.byteOffset ?? 0) + (b?.byteLength ?? 0))).toEqual(was.bin.subarray(a?.byteOffset ?? 0, (a?.byteOffset ?? 0) + (a?.byteLength ?? 0)));
    }
    const a = was.json.bufferViews[3]?.extensions?.EXT_meshopt_compression, b = now.json.bufferViews[3]?.extensions?.EXT_meshopt_compression;
    expect((b?.byteOffset ?? 0) % 4).toBe(0);
    expect(now.bin.subarray(b?.byteOffset ?? 0, (b?.byteOffset ?? 0) + (b?.byteLength ?? 0))).toEqual(was.bin.subarray(a?.byteOffset ?? 0, (a?.byteOffset ?? 0) + (a?.byteLength ?? 0)));
  });

  it('leaves a GLB with nothing to cut as the same bytes', () => {
    const small = glb(ktx2(256));
    expect(tierGlb(small, 512)).toBe(small);
  });
});

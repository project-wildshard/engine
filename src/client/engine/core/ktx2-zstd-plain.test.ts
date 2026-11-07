import { expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Node's zstd writes the fixture as the SDK bake does, and decodes it.
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { plainKtx2, prepareKtx2Zstd, unsupercompressKtx2, zstdLevels } from './ktx2Zstd';

/** A raw RGBA8 KTX2 with one zstd level, laid out as sharddev/bake/texture.ts `bakeRawColourTexture` writes it. */
function rawZstdKtx2(pixels: Uint8Array, width: number, height: number, vkFormat = 43): Uint8Array {
  const packed = zstdCompressSync(pixels, { params: { [constants.ZSTD_c_compressionLevel]: 19 } });
  const descriptor = 92, offset = 104 + descriptor, out = new Uint8Array(offset + packed.length), view = new DataView(out.buffer);
  out.set([171, 75, 84, 88, 32, 50, 48, 187, 13, 10, 26, 10]);
  [vkFormat, 1, width, height, 0, 0, 1, 1, 2, 104, descriptor].forEach((value, i) => { view.setUint32(12 + i * 4, value, true); });
  view.setBigUint64(80, BigInt(offset), true); view.setBigUint64(88, BigInt(packed.length), true); view.setBigUint64(96, BigInt(pixels.length), true);
  view.setUint32(104, descriptor, true);
  out.set(packed, offset);
  return out;
}

test('a raw zstd KTX2 is rewritten with its decoded level stored plain, the rest byte for byte', () => {
  const width = 8, height = 4, pixels = new Uint8Array(width * height * 4).map((_, i) => (i * 37) & 255);
  const file = rawZstdKtx2(pixels, width, height);
  const levels = zstdLevels(file);
  expect(levels).not.toBeNull();
  if (levels === null) return;
  expect(levels).toHaveLength(1);
  const decoded = levels.map(level => new Uint8Array(zstdDecompressSync(file.subarray(level.offset, level.offset + level.length))));
  const plain = plainKtx2(file, levels, decoded), view = new DataView(plain.buffer);
  expect(view.getUint32(44, true)).toBe(0); // no supercompression
  expect(view.getUint32(12, true)).toBe(43); // the same format
  const offset = Number(view.getBigUint64(80, true)), length = Number(view.getBigUint64(88, true));
  expect(offset % 16).toBe(0);
  expect(length).toBe(pixels.length); expect(Number(view.getBigUint64(96, true))).toBe(pixels.length);
  expect(plain.subarray(offset, offset + length)).toEqual(pixels);
  // header, level index and descriptor are kept (only the scheme and the level index change)
  expect(plain.subarray(104, 196)).toEqual(file.subarray(104, 196));
});

test('Basis and unsupercompressed files pass through untouched', async () => {
  const pixels = new Uint8Array(16).fill(7);
  expect(zstdLevels(rawZstdKtx2(pixels, 2, 2, 0))).toBeNull(); // vkFormat 0: a Basis payload (its transcoder decodes it)
  const plain = rawZstdKtx2(pixels, 2, 2); new DataView(plain.buffer).setUint32(44, 0, true);
  expect(zstdLevels(plain)).toBeNull();
  expect(zstdLevels(new Uint8Array(40))).toBeNull();
  // no Worker in this environment: the file is handed on unchanged
  const buffer = new ArrayBuffer(rawZstdKtx2(pixels, 2, 2).byteLength); new Uint8Array(buffer).set(rawZstdKtx2(pixels, 2, 2));
  expect(await unsupercompressKtx2(buffer)).toBe(buffer);
});

// DL17: the decoder starts on the caller's stack, before its first parse, only when a file needs it, and once
test('prepare starts the decoder worker for a raw zstd file only, once', () => {
  let made = 0;
  class FakeWorker extends EventTarget { constructor() { super(); made++; } postMessage(): void { /* unused */ } terminate(): void { /* unused */ } }
  vi.stubGlobal('Worker', FakeWorker);
  try {
    const plain = new Uint8Array(200);
    prepareKtx2Zstd([plain, undefined]);
    expect(made).toBe(0);
    const file = rawZstdKtx2(new Uint8Array(8 * 4 * 4), 8, 4);
    prepareKtx2Zstd([plain, file]);
    expect(made).toBe(1);
    prepareKtx2Zstd([file]);
    expect(made).toBe(1);
  } finally { vi.unstubAllGlobals(); }
});

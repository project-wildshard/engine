import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { DataTexture, SRGBColorSpace, LinearSRGBColorSpace, Texture } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import type { Renderer } from '../src/client/engine/render/renderer';
import { initKtx2, parseKtx2Bytes } from '../src/client/engine/core/ktx2';
import * as gpuFiles from '../src/client/engine/boot/gpuFiles';
import { bakeRawColourPixels } from '../src/sharddev/bake/rawTexture';

let loader: KTX2Loader | undefined;
beforeAll(() => {
  const detect = vi.spyOn(KTX2Loader.prototype, 'detectSupport').mockImplementation(function detectSupport(this: KTX2Loader) {
    this.workerConfig = { astcSupported: false, astcHDRSupported: false, etc1Supported: false, etc2Supported: false, dxtSupported: false, bptcSupported: false, pvrtcSupported: false };
    return this;
  });
  vi.spyOn(KTX2Loader.prototype, 'init').mockResolvedValue(undefined);
  vi.spyOn(gpuFiles, 'texMode').mockReturnValue('ktx2');
  initKtx2(legacyDouble<Renderer>({}));
  const detected = detect.mock.contexts[0];
  if (!(detected instanceof KTX2Loader)) throw new Error('Missing configured KTX2 loader');
  loader = detected;
});
afterAll(() => { loader?.dispose(); vi.restoreAllMocks(); });

function isTexture(value: unknown): value is DataTexture { return value instanceof DataTexture; }
function fixture(colourSpace: 'srgb' | 'linear' = 'srgb'): { bytes: Uint8Array; pixels: Uint8ClampedArray } {
  const pixels = Uint8ClampedArray.from({ length: 8 * 4 * 4 }, (_, index) => (index * 31 + 17) % 256);
  return { pixels, bytes: bakeRawColourPixels({ width: 8, height: 4, pixels }, { colourSpace }) };
}

test.each(['srgb', 'linear'] as const)('the real KTX2 decoder retains every %s pixel and owns only the selected input view', async colourSpace => {
  const { bytes, pixels } = fixture(colourSpace), backing = new Uint8Array(bytes.length + 10);
  backing.fill(91); backing.set(bytes, 4);
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('data:application/wasm;base64,')) return Promise.reject(new Error('Owned KTX2 cannot fetch assets'));
    return nativeFetch(input, init);
  });
  try {
    const pending = parseKtx2Bytes(backing.subarray(4, 4 + bytes.length));
    backing.fill(0);
    const texture = await pending;
    try {
      if (!isTexture(texture)) throw new Error('Raw KTX2 did not produce a data texture');
      const data: unknown = texture.image.data;
      if (!(data instanceof Uint8Array)) throw new Error('Missing original decoded pixels');
      expect(Buffer.compare(data, Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength))).toBe(0);
      expect(texture.image.width).toBe(8); expect(texture.image.height).toBe(4);
      expect(texture.colorSpace).toBe(colourSpace === 'srgb' ? SRGBColorSpace : LinearSRGBColorSpace);
      expect(texture.flipY).toBe(false);
      for (const [input] of fetch.mock.calls) expect(typeof input === 'string' && input.startsWith('data:application/wasm;base64,')).toBe(true);
    } finally { texture.dispose(); }
  } finally { fetch.mockRestore(); }
});

test('invalid and shared KTX2 input refuses before invoking the decoder', () => {
  if (loader === undefined) throw new Error('Missing configured KTX2 decoder');
  const decode = vi.spyOn(loader, 'parse');
  try {
    expect(() => parseKtx2Bytes(new Uint8Array(1))).toThrow();
    const bytes = fixture().bytes, corrupt = bytes.slice();
    new DataView(corrupt.buffer).setBigUint64(80, BigInt(bytes.length + 1), true);
    expect(() => parseKtx2Bytes(corrupt)).toThrow();
    const shared = new Uint8Array(new SharedArrayBuffer(bytes.length)); shared.set(bytes);
    expect(() => parseKtx2Bytes(shared)).toThrow('owned buffer');
    expect(decode).not.toHaveBeenCalled();
  } finally { decode.mockRestore(); }
});

test('decoder failure propagates and the next call can parse the same source', async () => {
  const bytes = fixture().bytes, error = new Error('Owned KTX2 decode refused');
  if (loader === undefined) throw new Error('Missing configured KTX2 decoder');
  const decode = vi.spyOn(loader, 'parse').mockImplementationOnce(() => { throw error; });
  try {
    await expect(parseKtx2Bytes(bytes)).rejects.toBe(error);
    const texture = await parseKtx2Bytes(bytes); expect(texture).toBeInstanceOf(Texture); texture.dispose();
    expect(decode).toHaveBeenCalledTimes(2);
  } finally { decode.mockRestore(); }
});

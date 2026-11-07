// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { widenRgbEtc2, widenRgbEtc2Async } from '@wildshard/engine/core/ktx2';
import { pageScope } from '@wildshard/engine/app/resources';

afterEach(() => { vi.restoreAllMocks(); });

const block = (seed: number): number[] => Array.from({ length: 8 }, (_, i) => (seed * 31 + i * 7) & 0xff);

it('widens RGB8 ETC2 to RGBA8 ETC2/EAC with an opaque alpha block before each colour block', () => {
  // 8×8 level 0 (four blocks), 4×4 level 1 (one block), as layers of a two-layer array
  const l0 = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7].flatMap(block));
  const l1 = Uint8Array.from([8, 9].flatMap(block));
  const t = new THREE.CompressedArrayTexture([{ data: l0, width: 8, height: 8 }, { data: l1, width: 4, height: 4 }], 8, 8, 2, THREE.RGB_ETC2_Format);
  const version = t.version;
  expect(widenRgbEtc2(t)).toBe(t);
  expect(t.format).toBe(THREE.RGBA_ETC2_EAC_Format);
  expect(t.version).toBeGreaterThan(version);
  const [m0, m1] = t.mipmaps;
  expect(m0?.data.byteLength).toBe(l0.byteLength * 2);
  expect(m1?.data.byteLength).toBe(l1.byteLength * 2);
  expect([m0?.width, m0?.height, m1?.width, m1?.height]).toEqual([8, 8, 4, 4]);
  const out = m0 === undefined ? new Uint8Array(0) : new Uint8Array(m0.data.buffer, m0.data.byteOffset, m0.data.byteLength);
  for (let b = 0; b < 8; b++) {
    expect([...out.subarray(b * 16, b * 16 + 8)]).toEqual([0xff, 0, 0, 0, 0, 0, 0, 0]);
    expect([...out.subarray(b * 16 + 8, b * 16 + 16)]).toEqual(block(b));
  }
});

it('leaves every other format alone', () => {
  const data = Uint8Array.from(block(1).concat(block(2)));
  const t = new THREE.CompressedTexture([{ data, width: 4, height: 4 }], 4, 4, THREE.RGBA_ASTC_4x4_Format);
  const version = t.version;
  widenRgbEtc2(t);
  expect(t.format).toBe(THREE.RGBA_ASTC_4x4_Format);
  expect(t.mipmaps[0]?.data).toBe(data);
  expect(t.version).toBe(version);
});

it('paces large array mips without publishing partial data or changing output bytes', async () => {
  const source = Uint8Array.from({ length: 131072 }, (_, index) => index * 17 & 255);
  const mipmaps = [{ data: source, width: 256, height: 256 }, { data: source.subarray(0, 32768), width: 128, height: 128 }];
  const direct = new THREE.CompressedArrayTexture(mipmaps, 256, 256, 4, THREE.RGB_ETC2_Format);
  const paced = new THREE.CompressedArrayTexture(mipmaps, 256, 256, 4, THREE.RGB_ETC2_Format);
  const expected = widenRgbEtc2(direct), version = paced.version;
  const timeout = vi.spyOn(pageScope, 'timeout');
  let at = 0; vi.spyOn(performance, 'now').mockImplementation(() => { at += 10; return at; });
  const pending = widenRgbEtc2Async(paced), concurrent = widenRgbEtc2Async(paced);
  expect(paced.mipmaps).toBe(mipmaps);
  expect(paced.format).toBe(THREE.RGB_ETC2_Format);
  expect(paced.version).toBe(version);
  expect(await pending).toBe(paced);
  expect(await concurrent).toBe(paced);
  expect(timeout.mock.calls.length).toBeGreaterThan(5);
  expect(paced.mipmaps).toEqual(expected.mipmaps);
  expect(paced.format).toBe(expected.format);
  expect(paced.version).toBe(version + 1);
  expect(source).toEqual(Uint8Array.from({ length: source.length }, (_, index) => index * 17 & 255));
});

it('retains other compressed formats through the paced callback', async () => {
  const data = Uint8Array.from(block(3)), mipmaps = [{ data, width: 4, height: 4 }];
  const texture = new THREE.CompressedTexture(mipmaps, 4, 4, THREE.RGBA_ASTC_4x4_Format);
  const version = texture.version;
  expect(await widenRgbEtc2Async(texture)).toBe(texture);
  expect(texture.mipmaps).toBe(mipmaps);
  expect(texture.version).toBe(version);
});

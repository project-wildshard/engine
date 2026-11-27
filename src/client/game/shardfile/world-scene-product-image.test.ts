import { afterEach, expect, test, vi } from 'vitest';
import { MeshBasicMaterial, NoColorSpace, SRGBColorSpace, Texture } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { TIER } from '@wildshard/engine/core/tier';
import { parseWorldScenes } from '@wildshard/format/worldScenes';
import { lendLooks } from './lentLooks';
import { SceneHandles } from './sceneHandles';
import { isKtx2Bytes, lendWorldSceneTextures } from './worldSceneTextures';

const realDecode = Reflect.get(globalThis, 'createImageBitmap');
afterEach(() => { vi.restoreAllMocks(); Reflect.set(globalThis, 'createImageBitmap', realDecode); });

// SF7i: Nine's baked sign atlas is a PNG since SF7a (J525: a shardfile carries images); its product rows read it as an image
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const KTX2 = Uint8Array.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
const product = (name: string, extra: object = {}) => ({ kind: 'product', looks: ['neon'], param: name, publish: `signs.${name}`, label: 'fixture sign atlas',
  file: { phone: `signs/${name}-phone.png`, desktop: `signs/${name}-desktop.png` }, sampler: { filter: 'linear', mips: 'gpu', anisotropy: 8 }, ...extra });
const lent = (rows: object[]) => parseWorldScenes({ version: 1, libraries: [], materials: [], steps: [], lent: rows }).lent;

test('a product image decodes as stored, with no renderer, and is lent and published like a KTX2 one', async () => {
  const decoded: { bytes: number[]; options: unknown }[] = [];
  Reflect.set(globalThis, 'createImageBitmap', async (blob: Blob, options: unknown) => {
    decoded.push({ bytes: [...new Uint8Array(await blob.arrayBuffer())], options });
    return { width: 4, height: 2, close: () => undefined };
  });
  const owner = new Scope('fixture-product-image'), handles = new SceneHandles(), textures = new Map<string, Texture>(), read: string[] = [];
  const material = new MeshBasicMaterial();
  lendLooks(owner, { materials: new Map([['neon', material]]), bindMeshMap: () => material, setParam: () => undefined, setTexture: (_id, name, texture) => { textures.set(name, texture); } });
  try {
    await lendWorldSceneTextures(lent([product('mono'), product('colour', { colour: 'srgb' })]), owner,
      { file: name => { read.push(name); return Promise.resolve(PNG); }, url: name => `/product/${name}` }, handles, undefined, 'standalone');
    expect(read.sort()).toEqual([`signs/colour-${TIER}.png`, `signs/mono-${TIER}.png`]);
    expect(decoded).toEqual([{ bytes: [...PNG], options: { premultiplyAlpha: 'none', colorSpaceConversion: 'none' } }, { bytes: [...PNG], options: { premultiplyAlpha: 'none', colorSpaceConversion: 'none' } }]);
    const mono = handles.texture('signs.mono'), colour = handles.texture('signs.colour');
    expect(mono).toBeInstanceOf(Texture);
    expect(textures.get('mono')).toBe(mono);
    expect(textures.get('colour')).toBe(colour);
    expect(mono.flipY).toBe(false);
    expect(mono.colorSpace).toBe(NoColorSpace);
    expect(colour.colorSpace).toBe(SRGBColorSpace);
    expect(mono.image).toMatchObject({ width: 4, height: 2 });
  } finally { owner.dispose(); material.dispose(); }
});

test('a KTX2 product still needs the world renderer, and only KTX2 bytes are read as KTX2', async () => {
  expect(isKtx2Bytes(KTX2)).toBe(true);
  expect(isKtx2Bytes(PNG)).toBe(false);
  expect(isKtx2Bytes(KTX2.subarray(0, 7))).toBe(false);
  const owner = new Scope('fixture-product-ktx2'), material = new MeshBasicMaterial();
  lendLooks(owner, { materials: new Map([['neon', material]]), bindMeshMap: () => material, setParam: () => undefined, setTexture: () => undefined });
  try {
    await expect(lendWorldSceneTextures(lent([product('mono')]), owner, { file: () => Promise.resolve(KTX2), url: name => `/product/${name}` }, new SceneHandles(), undefined, 'standalone'))
      .rejects.toThrow('Product textures need the world renderer');
  } finally { owner.dispose(); material.dispose(); }
});

// oxlint-disable-next-line import/no-nodejs-modules -- The fixture deflates its voxels as the bake does.
import { deflateSync } from 'node:zlib';
import { afterEach, expect, test, vi } from 'vitest';
import { Data3DTexture, MeshBasicMaterial, type Texture } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { TIER } from '@wildshard/engine/core/tier';
import type { GraphLiteral } from '@wildshard/format/materialGraph';
import { parseWorldScenes } from '@wildshard/format/worldScenes';
import { lendLooks } from './lentLooks';
import { SceneHandles } from './sceneHandles';
import { lendWorldSceneTextures } from './worldSceneTextures';

afterEach(() => { vi.restoreAllMocks(); });

const volume = (file: string, fill: number, maximum: number) => ({ file, size: [2, 1, 1], min: [fill, 0, 0], inv: [0.5, 1, 1], maximum });
const rows = parseWorldScenes({ version: 1, libraries: [], materials: [], steps: [], lent: [{ kind: 'volume', looks: ['lit'], label: 'fixture light volumes', publish: 'light.A',
  params: { texture: 'uVol', min: 'uMin', inv: 'uInv', maximum: 'uMax' },
  files: { standalone: { phone: volume('capped-phone.bin', 1, 3), desktop: volume('capped-desktop.bin', 2, 4) }, cell: { phone: volume('open-phone.bin', 5, 7), desktop: volume('open-desktop.bin', 6, 8) } } }] }).lent;

test('a lent volume decodes its world variant\'s voxels, lends them with its box to its looks and publishes them', async () => {
  const voxels = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), fetched: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(url => { fetched.push(url instanceof Request ? url.url : url instanceof URL ? url.href : url); return Promise.resolve(new Response(deflateSync(voxels))); });
  const owner = new Scope('fixture-volumes'), handles = new SceneHandles(), params = new Map<string, GraphLiteral>(), textures = new Map<string, Texture>();
  const material = new MeshBasicMaterial();
  lendLooks(owner, { materials: new Map([['lit', material]]), bindMeshMap: () => material,
    setParam: (_id, name, value) => { params.set(name, value); }, setTexture: (_id, name, texture) => { textures.set(name, texture); } });
  try {
    await lendWorldSceneTextures(rows, owner, { file: () => Promise.reject(new Error('Volumes are fetched by url')), url: name => `/product/${name}` }, handles, undefined, 'cell');
    expect(fetched).toEqual([`/product/open-${TIER}.bin`]);
    const texture = handles.texture('light.A');
    expect(texture).toBeInstanceOf(Data3DTexture);
    expect(textures.get('uVol')).toBe(texture);
    expect(params.get('uMin')).toEqual([TIER === 'phone' ? 5 : 6, 0, 0]);
    expect(params.get('uInv')).toEqual([0.5, 1, 1]);
    expect(params.get('uMax')).toBe(TIER === 'phone' ? 7 : 8);
    expect(handles.vector('light.A.min').toArray()).toEqual([TIER === 'phone' ? 5 : 6, 0, 0]);
    expect(handles.number('light.A.maximum')).toBe(TIER === 'phone' ? 7 : 8);
  } finally { owner.dispose(); material.dispose(); }
});

test('a lent volume refuses voxels of the wrong size, a degenerate grid and an extra field', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(deflateSync(Uint8Array.from([1, 2, 3, 4])))));
  const owner = new Scope('fixture-volumes'), material = new MeshBasicMaterial();
  lendLooks(owner, { materials: new Map([['lit', material]]), bindMeshMap: () => material, setParam: () => undefined, setTexture: () => undefined });
  try {
    await expect(lendWorldSceneTextures(rows, owner, { file: () => Promise.reject(new Error('Volumes are fetched by url')), url: name => `/product/${name}` }, new SceneHandles(), undefined, 'standalone'))
      .rejects.toThrow('size differs');
  } finally { owner.dispose(); material.dispose(); }
  const lent = (files: unknown, extra: object = {}) => ({ version: 1, libraries: [], materials: [], steps: [], lent: [{ kind: 'volume', looks: ['lit'], label: 'fixture', publish: 'light.A',
    params: { texture: 'uVol', min: 'uMin', inv: 'uInv', maximum: 'uMax' }, files, ...extra }] });
  const flat = { ...volume('flat.bin', 0, 1), size: [0, 1, 1] }, good = { phone: volume('a.bin', 0, 1), desktop: volume('b.bin', 0, 1) };
  expect(() => parseWorldScenes(lent({ standalone: good, cell: { ...good, phone: flat } }))).toThrow();
  expect(() => parseWorldScenes(lent({ standalone: good }))).toThrow();
  expect(() => parseWorldScenes(lent({ standalone: good, cell: good }, { url: '/x.bin' }))).toThrow();
});

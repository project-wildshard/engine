import { expect, test } from 'vitest';
import { DataTexture, MeshBasicMaterial, RedFormat, RepeatWrapping, Vector3, type Texture } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { parseWorldScenes } from '@wildshard/format/worldScenes';
import { lendLooks, lentUniforms } from './lentLooks';
import { SceneHandles } from './sceneHandles';
import { lendWorldSceneTextures } from './worldSceneTextures';
import { lendWorldSceneUniforms } from './worldSceneUniforms';

/** an orchard's weave (2 x 2 r8) lent to its looks and published, and its live air set bound to the scene's handles */
const scenes = (size: readonly [number, number] = [2, 2]) => parseWorldScenes({ version: 1, libraries: [], materials: [], steps: [],
  lent: [{ kind: 'raster', looks: ['woven'], param: 'uWeave', file: 'weave.r8', size, format: 'r8', wrap: 'repeat', magnify: 'linear', mipmaps: true, label: 'orchard weave', publish: 'weave' }],
  uniforms: [{ id: 'orchard-air', rows: { uMist: 0.5, uTint: { rgb: 0xff0000 }, uBands: { v4s: [[1, 2, 3, 4]] }, uDir: { v3: [0, 2, 0], normalize: true } },
    textures: { uWeave: 'weave' }, vectors: { uAt: 'at' }, numbers: { uPeak: 'peak' } }] });

test('a lent raster is lent and published, and a uniform set is made from its rows, bound to the scene handles and lent by id', async () => {
  const owner = new Scope('orchard-air'), handles = new SceneHandles(), textures = new Map<string, Texture>(), material = new MeshBasicMaterial();
  lendLooks(owner, { materials: new Map([['woven', material]]), bindMeshMap: () => material, setParam: () => undefined,
    setTexture: (_id, name, texture) => { textures.set(name, texture); } });
  const product = { file: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])), url: (name: string) => name };
  try {
    const rows = scenes();
    await lendWorldSceneTextures(rows.lent, owner, product, handles, undefined, 'standalone');
    const weave = handles.texture('weave');
    expect(weave).toBeInstanceOf(DataTexture); expect(textures.get('uWeave')).toBe(weave);
    expect([weave.format, weave.wrapS, weave.wrapT, weave.generateMipmaps]).toEqual([RedFormat, RepeatWrapping, RepeatWrapping, true]);
    const at = new Vector3(1, 2, 3); handles.publish('at', at); handles.publish('peak', 7);
    lendWorldSceneUniforms(rows.uniforms, owner, handles);
    const air = lentUniforms('orchard-air');
    expect(air['uMist']?.value).toBe(0.5); expect(air['uWeave']?.value).toBe(weave); expect(air['uAt']?.value).toBe(at); expect(air['uPeak']?.value).toBe(7);
    expect(air['uDir']?.value).toEqual(new Vector3(0, 1, 0));
    // a raster whose bytes are not its size, a non-numeric row and an unpublished handle refuse
    await expect(lendWorldSceneTextures(scenes([4, 4]).lent, owner, product, new SceneHandles(), undefined, 'standalone')).rejects.toThrow('size differs');
    expect(() => parseWorldScenes({ version: 1, libraries: [], materials: [], steps: [], uniforms: [{ id: 'bad', rows: { uMist: 'thick' } }] })).toThrow();
    expect(() => { lendWorldSceneUniforms(rows.uniforms, owner, new SceneHandles()); }).toThrow();
  } finally { owner.dispose(); material.dispose(); }
  expect(() => lentUniforms('orchard-air')).toThrow('No lent uniforms orchard-air');
});

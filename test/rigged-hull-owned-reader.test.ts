import { afterEach, expect, test, vi } from 'vitest';
import { Bone, BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, Skeleton, SkinnedMesh, Texture, TextureLoader, Uint16BufferAttribute } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { riggedHulls } from '@wildshard/engine/game/looks/riggedHulls';

afterEach(() => { vi.restoreAllMocks(); });

async function sourceRig(): Promise<GLTF> {
  const file = await new GLTFLoader().parseAsync(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [] }), '');
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(12), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const bone = new Bone(); bone.name = 'body';
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  mesh.add(bone); mesh.bind(new Skeleton([bone])); file.scene.add(mesh); return file;
}

const row = { label: 'owned', rigs: ['body'], hulls: { 'bird:adult': 'body' } };
const files = { body: { rig: 'creature/body.glb', base: 'creature/base.ktx2', normal: 'creature/normal.ktx2' } };

test('named rigs, maps and coats reuse verified transport without a second URL request', async () => {
  const urlRead = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValue(new Error('Unexpected URL read'));
  const rig = vi.fn((_name: string) => sourceRig()), textures: Texture[] = [];
  const texture = vi.fn((_name: string): Promise<Texture> => { const value = new Texture(); textures.push(value); return Promise.resolve(value); });
  const family = riggedHulls(row, { files, coats: { 'body:bird:adult': { key: '/original/coat.png', image: 'creature/coat.ktx2' } } }, { rig, texture });
  await family.preload(); await family.preload();
  const live = await family.load('body');
  expect(rig.mock.calls).toEqual([['creature/body.glb']]);
  expect(texture.mock.calls).toEqual([['creature/base.ktx2'], ['creature/normal.ktx2'], ['creature/coat.ktx2']]);
  expect(urlRead).not.toHaveBeenCalled();
  expect(Array.from(live.geometry.getAttribute('position').array)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  expect(live.joints.map(joint => joint.name)).toEqual(['body']);
  live.geometry.dispose(); for (const value of textures) value.dispose();
});

test('a refused verified map frees its sibling and never falls back to the URL loader', async () => {
  const urlRead = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValue(new Error('Unexpected URL read'));
  const base = new Texture(), dispose = vi.spyOn(base, 'dispose');
  const texture = vi.fn((name: string): Promise<Texture> => name === 'creature/base.ktx2'
    ? Promise.resolve(base) : Promise.reject(new Error('Verified body hash mismatch')));
  const family = riggedHulls(row, { files, coats: {} }, { rig: sourceRig, texture });
  await expect(family.preload()).rejects.toThrow('Verified body hash mismatch');
  expect(dispose).toHaveBeenCalledOnce(); expect(urlRead).not.toHaveBeenCalled();
  expect(() => family.skin('bird', 'adult', [])).toThrow('not prepared');
});


test('a public image coat keeps the original image decoder beside verified rig maps', async () => {
  const image = new Texture<HTMLImageElement>(), imageRead = vi.spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(image);
  const textures: Texture[] = [], texture = vi.fn((_name: string): Promise<Texture> => {
    const value = new Texture(); textures.push(value); return Promise.resolve(value);
  });
  const family = riggedHulls(row, { files, coats: { 'body:bird:adult': { key: '/unmapped/coat.png', image: '/original/coat.png' } } }, { rig: sourceRig, texture });
  await family.preload();
  expect(texture.mock.calls).toEqual([['creature/base.ktx2'], ['creature/normal.ktx2']]);
  expect(imageRead).toHaveBeenCalledExactlyOnceWith('/original/coat.png');
  (await family.load('body')).geometry.dispose(); for (const value of [...textures, image]) value.dispose();
});


test('preparing one species leaves unrelated hulls cold until their own preparation', async () => {
  const rig = vi.fn((_name: string) => sourceRig());
  const family = riggedHulls({ label: 'species', rigs: ['body', 'other'], hulls: { 'bird:adult': 'body', 'boar:adult': 'other' } },
    { files: { body: 'bird.glb', other: 'boar.glb' }, coats: {} }, { rig, texture: () => Promise.reject(new Error('No separate maps')) });
  await family.preload('bird');
  expect(rig.mock.calls).toEqual([['bird.glb']]);
  expect(() => family.skin('boar', 'adult', [])).toThrow('not prepared');
  await family.preload('bird'); expect(rig).toHaveBeenCalledTimes(1);
  await family.preload('boar'); expect(rig.mock.calls).toEqual([['bird.glb'], ['boar.glb']]);
  await family.preload(); expect(rig).toHaveBeenCalledTimes(2);
  (await family.load('body')).geometry.dispose(); (await family.load('other')).geometry.dispose();
});

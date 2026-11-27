import * as THREE from 'three';
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { atlasFigureSkin } from './figureSkins';

class SourceBitmap {
  closed = false;
  close(): void { this.closed = true; }
}

function file(object: THREE.Object3D): GLTF {
  const scene = new THREE.Group();
  scene.add(object);
  return { scene } as GLTF;
}

function source(image: SourceBitmap): GLTF {
  return file(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: new THREE.Texture(image) })));
}

function readyMesh(): GLTF {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0], 4));
  const root = new THREE.Bone(); root.name = 'root';
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.add(root);
  mesh.bind(new THREE.Skeleton([root]));
  return file(mesh);
}

const row = { url: 'merged.glb', name: 'merged', skeleton: 'figures', columns: 2, rows: 1, cell: 16,
  sources: ['first.glb', 'second.glb'], joints: ['root'], rim: 0, bands: 1 };
const sky = { csm: { lights: [] }, sunDir: new THREE.Vector3(0, 1, 0), setupMaterial: vi.fn() } as unknown as SkyRig;

afterEach(() => { vi.unstubAllGlobals(); });

test('the merged figure copies each bitmap into its assigned cell before retiring it', async () => {
  const first = new SourceBitmap(), second = new SourceBitmap();
  const gpu = new THREE.CompressedTexture([], 1024, 1024);
  const read = vi.fn((url: string, _aliases?: Readonly<Record<string, string>>, form?: 'img'): Promise<GLTF> => {
    if (url === row.url) return Promise.resolve(readyMesh());
    return Promise.resolve(form === 'img' ? source(url === 'first.glb' ? first : second)
      : file(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: gpu }))));
  });
  const drawImage = vi.fn((image: SourceBitmap) => { expect(image.closed).toBe(false); });
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }) };
  vi.stubGlobal('ImageBitmap', SourceBitmap);
  vi.stubGlobal('document', { createElement: () => canvas });
  const owner = new Scope('figure atlas fixture');
  try {
    const mesh = await atlasFigureSkin(row, sky, owner, undefined, read);
    expect(read.mock.calls).toEqual([[row.url], ['first.glb', undefined, 'img'], ['second.glb', undefined, 'img']]);
    expect(drawImage.mock.calls).toEqual([[first, 0, 0, 16, 16], [second, 16, 0, 16, 16]]);
    expect([first.closed, second.closed]).toEqual([true, true]);
    expect(mesh.material).toMatchObject({ map: { image: canvas } });
  } finally { owner.dispose(); }
});

// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { Material, Object3D, Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RenderItem } from 'three/src/renderers/webgl/WebGLRenderLists.js';
import { gltfOpaqueSort, installGltfMaterialOrder } from './gltfMaterialOrder';
import { installGltfKtx2 } from '../core/ktx2';

const document = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }],
  nodes: [{ mesh: 0 }, { mesh: 1 }], meshes: [0, 1].map(material => ({ primitives: [{ attributes: { POSITION: 0 }, material }] })),
  buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
  textures: [{ source: 0 }, { source: 1 }], images: [{ uri: 'first.png' }, { uri: 'second.png' }],
  materials: [0, 1].map(index => ({ pbrMetallicRoughness: { baseColorTexture: { index } } })),
};
const source = JSON.stringify(document);

function deferred() {
  let done = (): void => undefined;
  const promise = new Promise<void>(resolve => { done = resolve; });
  return { promise, resolve: () => { done(); } };
}
function id(material: Material): number {
  const value: unknown = Reflect.get(material, 'id');
  if (typeof value !== 'number') throw new Error('Missing native fixture material identity');
  return value;
}
function intake(bridge = false, points = false) {
  if (bridge) installGltfKtx2(GLTFLoader);
  const loader = new GLTFLoader(), images = [deferred(), deferred()], completed = [deferred(), deferred()];
  const bytes = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer;
  if (!bridge) { installGltfMaterialOrder(loader); installGltfMaterialOrder(loader); }
  loader.register(parser => {
    const load = parser.loadMaterial.bind(parser);
    parser.loadBuffer = () => Promise.resolve(bytes.slice(0));
    parser.loadImageSource = async index => {
      const image = images[index]; if (image === undefined) throw new Error('Unexpected fixture image');
      await image.promise;
      return new Texture();
    };
    parser.loadMaterial = async index => {
      const material = await load(index), ready = completed[index];
      if (ready === undefined) throw new Error('Unexpected fixture material');
      ready.resolve(); return material;
    };
    return { name: 'controlled-native-images' };
  });
  const ready = loader.parseAsync(points ? JSON.stringify({ ...document, meshes: document.meshes.map(mesh => ({
    primitives: mesh.primitives.map(primitive => ({ ...primitive, mode: 0 })),
  })) }) : source, '');
  return { ready, async release(index: number): Promise<void> {
    const image = images[index], material = completed[index];
    if (image === undefined || material === undefined) throw new Error('Missing fixture gate');
    image.resolve(); await material.promise;
  } };
}
function isMaterial(value: unknown): value is Material { return value instanceof Material; }
function materials(file: GLTF): Material[] {
  return file.scene.children.map(child => {
    const material: unknown = Reflect.get(child, 'material');
    if (!isMaterial(material)) throw new Error('Missing native primitive material');
    return material;
  });
}
function item(material: Material, change: Partial<RenderItem> = {}): RenderItem {
  return { id: 0, object: new Object3D(), geometry: null, material, materialVariant: 0, groupOrder: 0,
    renderOrder: 0, z: 1, group: null, ...change };
}
async function parsed(reverse: boolean, bridge = false, points = false): Promise<GLTF> {
  const read = intake(bridge, points);
  await read.release(reverse ? 1 : 0); await read.release(reverse ? 0 : 1);
  return read.ready;
}

test('opposite native texture completion orders retain declared opaque material order', async () => {
  for (const reverse of [false, true]) {
    const file = await parsed(reverse), [first, second] = materials(file);
    if (first === undefined || second === undefined) throw new Error('Missing native materials');
    const ids = [id(first), id(second)];
    expect(id(first) < id(second)).toBe(!reverse);
    expect(gltfOpaqueSort(item(first), item(second))).toBeLessThan(0);
    expect(gltfOpaqueSort(item(second), item(first))).toBeGreaterThan(0);
    expect([id(first), id(second)]).toEqual(ids);
    expect(first.userData).toEqual({}); expect(second.userData).toEqual({});
  }
});

test('the original constructor bridge also orders frozen-shard direct loaders', async () => {
  const [first, second] = materials(await parsed(true, true));
  if (first === undefined || second === undefined) throw new Error('Missing native materials');
  expect(id(first)).toBeGreaterThan(id(second));
  expect(gltfOpaqueSort(item(first), item(second))).toBeLessThan(0);
});

test('native material clones and copy replacement carry only the current private sort identity', async () => {
  const [first, second] = materials(await parsed(true));
  if (first === undefined || second === undefined) throw new Error('Missing native materials');
  const clone = first.clone(), replacement = new Material();
  expect(id(clone)).not.toBe(id(first)); expect(clone.uuid).not.toBe(first.uuid);
  expect(gltfOpaqueSort(item(clone), item(second))).toBeLessThan(0);
  expect(clone.userData).toEqual(first.userData);
  replacement.copy(second);
  expect(gltfOpaqueSort(item(first), item(replacement))).toBeLessThan(0);
  const plain = new Material(); replacement.copy(plain);
  expect(gltfOpaqueSort(item(replacement), item(plain))).toBe(id(replacement) - id(plain));
});

test('native group, explicit order, variant, depth and object tie-breaks keep their priority', async () => {
  const [first, second] = materials(await parsed(true));
  if (first === undefined || second === undefined) throw new Error('Missing native materials');
  expect(gltfOpaqueSort(item(first, { groupOrder: 2 }), item(second, { groupOrder: 1 }))).toBe(1);
  expect(gltfOpaqueSort(item(first, { renderOrder: 2 }), item(second, { renderOrder: 1 }))).toBe(1);
  expect(gltfOpaqueSort(item(first, { materialVariant: 2 }), item(first, { materialVariant: 1 }))).toBe(1);
  expect(gltfOpaqueSort(item(first, { z: 2 }), item(first, { z: 1 }))).toBe(1);
  expect(gltfOpaqueSort(item(first, { id: 2 }), item(first, { id: 1 }))).toBe(1);
  const plain = new Material();
  expect(gltfOpaqueSort(item(plain), item(first))).toBeGreaterThan(0);
});

test('primitives without an authored material preserve the native default', async () => {
  const loader = new GLTFLoader(); installGltfMaterialOrder(loader);
  loader.register(parser => {
    parser.loadBuffer = () => Promise.resolve(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
    return { name: 'default-material-bytes' };
  });
  const file = await loader.parseAsync(JSON.stringify({ ...document, nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }] }), '');
  const [material] = materials(file); if (material === undefined) throw new Error('Missing default material');
  expect(material.type).toBe('MeshStandardMaterial');
  expect(gltfOpaqueSort(item(material), item(material))).toBe(0);
});

test('native point-material conversion inherits declaration order before its copy', async () => {
  const file = await parsed(true, false, true), [first, second] = materials(file);
  if (first === undefined || second === undefined) throw new Error('Missing point materials');
  expect(file.scene.children.map(child => child.type)).toEqual(['Points', 'Points']);
  expect(first.type).toBe('PointsMaterial'); expect(second.type).toBe('PointsMaterial');
  expect(gltfOpaqueSort(item(first), item(second))).toBeLessThan(0);
});

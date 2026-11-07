// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { BufferGeometry, Mesh, MeshStandardMaterial, Texture, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { rigAtlasReader } from './rigAtlas';

function fixture(animated = false): string {
  return JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [1, 0] }],
    nodes: [{ mesh: 0 }, { mesh: 1 }, { mesh: 0 }],
    meshes: [0, 1].map(material => ({ primitives: [{ indices: 1, attributes: { POSITION: 0, TEXCOORD_0: 2 }, material }] })),
    buffers: [{ byteLength: 68 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }, { buffer: 0, byteOffset: 44, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }, { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' }],
    samplers: [{ wrapS: 33071, wrapT: 33648, minFilter: 9984, magFilter: 9728 }],
    textures: [0, 1].map(source => ({ source, sampler: 0 })), images: [0, 1].map(index => ({ uri: `image-${index}.png` })),
    extensionsUsed: ['KHR_texture_transform'],
    materials: [0, 1].map(index => ({ pbrMetallicRoughness: { baseColorTexture: { index,
      extensions: { KHR_texture_transform: { offset: [0.2, 0.3], scale: [0.7, 0.8], rotation: 0.4, texCoord: 1 } } } } })),
    ...(animated ? { animations: [{ samplers: [], channels: [] }] } : {}),
  });
}
function reader(defer = false): { loader: GLTFLoader; geometryReads: () => number; release: () => void; ready: Promise<void> } {
  const loader = new GLTFLoader(), bytes = new ArrayBuffer(68);
  new Float32Array(bytes, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Uint16Array(bytes, 36, 3).set([0, 1, 2]); new Float32Array(bytes, 44, 6).set([0, 0, 1, 0, 0, 1]);
  let geometryReads = 0, release = (): void => undefined;
  let ready = (): void => undefined;
  const firstImage = new Promise<void>(resolve => { ready = resolve; });
  const held = defer ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
  loader.register(parser => {
    const original = parser.loadGeometries.bind(parser);
    parser.loadGeometries = (...args) => { geometryReads++; return original(...args); };
    parser.loadBuffer = () => Promise.resolve(bytes.slice(0));
    parser.loadImageSource = async index => {
      if (index === 1) await held; else ready();
      const texture = new Texture(); texture.name = `image-${index}`; return texture;
    };
    return { name: 'fixture-images' };
  });
  return { loader, ready: firstImage, geometryReads: () => geometryReads, release: () => { release(); } };
}
function originalAtlas(root: Object3D): Texture | null {
  let map: Texture | null = null;
  root.traverse(node => {
    if (map !== null || !(node instanceof Mesh)) return;
    const stored: unknown = node.material, geometry: unknown = node.geometry;
        const material: unknown = Array.isArray(stored) ? stored[0] : stored;
    if (material instanceof MeshStandardMaterial && material.map !== null && geometry instanceof BufferGeometry && geometry.hasAttribute('uv') && geometry.index !== null) map = material.map;
  });
  return map;
}
function state(texture: Texture | null): unknown {
  if (texture === null) throw new Error('Missing fixture atlas');
  return [texture.name, texture.channel, texture.flipY, texture.colorSpace, texture.wrapS, texture.wrapT,
    texture.minFilter, texture.magFilter, texture.generateMipmaps, texture.offset.toArray(), texture.repeat.toArray(), texture.rotation];
}

test('prepared atlas retains native scene order, sampler, colour space and UV transform without decoding unused meshes', async () => {
  const original = reader(), prepared = reader(), atlas = rigAtlasReader(prepared.loader);
  const full = await original.loader.parseAsync(fixture(), ''), light = await prepared.loader.parseAsync(fixture(), '');
  expect(original.geometryReads()).toBeGreaterThan(0); expect(prepared.geometryReads()).toBe(0);
  expect(state(atlas(light.scene))).toEqual(state(originalAtlas(full.scene)));
  let meshes = 0; light.scene.traverse(node => { if (node instanceof Mesh) meshes++; }); expect(meshes).toBe(0);
});

test('native scene order wins over material completion order, including reused mesh nodes', async () => {
  const prepared = reader(true), atlas = rigAtlasReader(prepared.loader), pending = prepared.loader.parseAsync(fixture(), '');
  await prepared.ready; prepared.release();
  const loaded = await pending;
  expect(atlas(loaded.scene)?.name).toBe('image-1.png'); expect(prepared.geometryReads()).toBe(0);
});

test('animated originals keep the ordinary mesh parser and atlas selection', async () => {
  const original = reader(), prepared = reader(), atlas = rigAtlasReader(prepared.loader);
  const full = await original.loader.parseAsync(fixture(true), ''), light = await prepared.loader.parseAsync(fixture(true), '');
  expect(prepared.geometryReads()).toBeGreaterThan(0);
  expect(state(atlas(light.scene))).toEqual(state(originalAtlas(full.scene)));
});

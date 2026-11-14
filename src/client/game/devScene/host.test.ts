import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { Physics } from '@wildshard/engine/physics/Physics';
import { DevSceneHost } from './host';
import { decodeGeometry, type DevGeometry, type DevPart } from './wire';

const box = new THREE.BoxGeometry(2, 1, 2);
const geometry: DevGeometry = { position: box.attributes['position']?.array as Float32Array, normal: box.attributes['normal']?.array as Float32Array,
  uv: box.attributes['uv']?.array as Float32Array, colour: null, index: Uint32Array.from(box.index?.array ?? []) };
const assets = { geometry: (): DevGeometry => geometry, texture: (): Uint8Array => new Uint8Array(2 * 2 * 4).fill(200) };
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const hut = (hash: string, colour: [number, number, number]): DevPart => ({
  name: 'hut', hash, geometries: ['g1'], textures: [{ key: 't1', width: 2, height: 2, colourSpace: 'srgb' }],
  materials: [{ key: 'roof', name: 'roof', kind: 'standard', colour, roughness: 0.8, metalness: 0, emissive: [0, 0, 0], emissiveIntensity: 1, map: 't1', repeat: [2, 1], offset: [0, 0],
    alphaTest: 0, side: 'front', vertexColours: false, transparent: false, opacity: 1, blending: 'normal', depthWrite: true, fog: true }],
  draws: [{ geometry: 'g1', material: 'roof', matrix: identity, instances: null, castShadow: true, receiveShadow: true },
    { geometry: 'g1', material: 'roof', matrix: identity, instances: { count: 2, matrices: [...identity, ...identity.map((v, i) => i === 12 ? 5 : v)], colours: null }, castShadow: false, receiveShadow: false }],
  sprites: [], lights: [{ colour: [1, 0.6, 0.3], intensity: 4, distance: 9, decay: 2, position: [0, 2, 0] }],
  colliders: [{ centre: [0, 0.5, 0], half: [1, 0.5, 1], rotation: [0, 0, 0, 1] }], water: [{ tint: [0.1, 0.1, 0.2], triangles: [0, 0, 0, 1, 0, 0, 0, 0, 1] }],
});
const moved = (name: string, hash: string, geometries: string[]): DevPart => ({ ...hut(hash, [1, 1, 1]), name, geometries, draws: geometries.map(key => ({ geometry: key, material: 'roof', matrix: identity, instances: null, castShadow: false, receiveShadow: false })), colliders: [] });
const meshes = (root: THREE.Object3D): THREE.Mesh[] => { const out: THREE.Mesh[] = []; root.traverse(o => { if (o instanceof THREE.Mesh) out.push(o as THREE.Mesh); }); return out; };

test('AP5: a part pushed twice swaps its draws and colliders in one call; shared geometry survives; the player is untouched', async () => {
  const R = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../../../../node_modules/@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm', import.meta.url))));
  const scope = new Scope('test.devScene'), scene = new THREE.Scene(), physics = new Physics(R);
  const player = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(3, 1, -2));
  const colliders = (): number => { let n = 0; physics.world.forEachCollider(() => { n++; }); return n; };
  const host = new DevSceneHost(scope, scene, physics);
  let frames = 0; const frame = (): void => { frames++; physics.step(); };

  host.apply(hut('a', [1, 0, 0]), assets);
  frame();
  expect(host.root.children).toHaveLength(1);
  expect(meshes(host.root)).toHaveLength(3);
  const before = meshes(host.root)[0]?.material as THREE.MeshStandardMaterial;
  expect(before.color.getHex()).toBe(0xff0000);
  expect(before.map?.repeat.x).toBe(2);
  expect(colliders()).toBe(1);
  let disposed = 0; before.addEventListener('dispose', () => { disposed++; });
  const shared = meshes(host.root)[0]?.geometry; let geometryDisposed = 0; shared?.addEventListener('dispose', () => { geometryDisposed++; });

  host.apply(hut('b', [0, 0, 1]), assets);
  frame();
  expect(host.root.children).toHaveLength(1);
  const after = meshes(host.root)[0]?.material as THREE.MeshStandardMaterial;
  expect(after.color.getHex()).toBe(0x0000ff);
  expect(disposed).toBe(1);
  expect(geometryDisposed).toBe(0);
  expect(meshes(host.root)[0]?.geometry).toBe(shared);
  expect(colliders()).toBe(1);
  expect(host.applied).toEqual(['hut@a', 'hut@b']);
  expect(frames).toBe(2);
  expect(player.translation()).toEqual({ x: 3, y: 1, z: -2 });

  host.remove('hut');
  expect(host.root.children).toHaveLength(0);
  expect(geometryDisposed).toBe(1);
  expect(colliders()).toBe(0);
  scope.dispose();
  expect(scene.children).toHaveLength(0);
});

test('AP5: the geometry wire decodes what the watch server encodes', () => {
  const counts = [9, 9, 6, 0, 3], body = [0, 1, 2, 3, 4, 5, 6, 7, 8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const bytes = new ArrayBuffer(20 + (body.length + 3) * 4), view = new DataView(bytes);
  counts.forEach((c, i) => { view.setUint32(i * 4, c, true); });
  new Float32Array(bytes, 20, body.length).set(body);
  new Uint32Array(bytes, 20 + body.length * 4, 3).set([0, 1, 2]);
  const decoded = decodeGeometry(bytes);
  expect(decoded.position[8]).toBe(8);
  expect(decoded.uv?.length).toBe(6);
  expect(decoded.colour).toBeNull();
  expect([...decoded.index ?? []]).toEqual([0, 1, 2]);
});

test('AP5: a geometry that moves between parts in one revision survives; a part that fails to build leaves nothing behind', () => {
  const scope = new Scope('test.devScene.batch'), host = new DevSceneHost(scope, new THREE.Scene(), null);
  host.applyAll([moved('a', '1', ['g1']), moved('b', '1', ['g2'])], assets);
  expect(host.held()).toEqual({ geometries: 2, textures: 1 });
  // g1 leaves a for b in the same revision: a's release must not drop it before b holds it
  host.applyAll([moved('a', '2', ['g2']), moved('b', '2', ['g1'])], assets);
  expect(host.held()).toEqual({ geometries: 2, textures: 1 });
  expect(meshes(host.root).every(mesh => mesh.geometry.attributes['position'] !== undefined)).toBe(true);
  // a part naming a material it does not carry refuses; the scene keeps revision 2 and holds nothing new
  const broken: DevPart = { ...moved('a', '3', ['g3']), draws: [{ geometry: 'g3', material: 'missing', matrix: identity, instances: null, castShadow: false, receiveShadow: false }] };
  expect(() => { host.applyAll([moved('b', '3', ['g4']), broken], assets); }).toThrow('names material missing');
  expect(host.held()).toEqual({ geometries: 2, textures: 1 });
  expect([host.hash('a'), host.hash('b')]).toEqual(['2', '2']);
  host.remove('a'); host.remove('b');
  expect(host.held()).toEqual({ geometries: 0, textures: 0 });
  scope.dispose();
});

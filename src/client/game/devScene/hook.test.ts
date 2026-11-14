import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { Physics } from '@wildshard/engine/physics/Physics';
import type { LookKey } from '@wildshard/engine/render/dataLook';
import type { LookStrategy } from '@wildshard/engine/render/look';
import { createDevHook, DEV_HOOK_VERSION, type DevGeometry, type DevHookPorts, type DevPart } from './hook';
import { isDevColliders, swapDevBoxes, type DevBox } from '@wildshard/engine/game/devColliders';

const box = new THREE.BoxGeometry(2, 1, 2);
const geometry = (key: string): DevGeometry => ({ key, position: box.attributes['position']?.array as Float32Array, normal: box.attributes['normal']?.array as Float32Array,
  uv: box.attributes['uv']?.array as Float32Array, colour: null, index: Uint32Array.from(box.index?.array ?? []) });
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const hut = (colour: [number, number, number]): DevPart => ({
  geometries: [geometry('g1')], textures: [{ key: 't1', width: 2, height: 2, colourSpace: 'srgb', rgba: new Uint8Array(16).fill(200) }],
  materials: [{ key: 'roof', name: 'roof', kind: 'standard', colour, roughness: 0.8, metalness: 0, emissive: [0, 0, 0], emissiveIntensity: 1, map: 't1', repeat: [2, 1], offset: [0, 0],
    alphaTest: 0, side: 'front', vertexColours: false, transparent: false, opacity: 1, blending: 'normal', depthWrite: true, fog: true }],
  draws: [{ geometry: 'g1', material: 'roof', matrix: identity, instances: null, castShadow: true, receiveShadow: true },
    { geometry: 'g1', material: 'roof', matrix: identity, instances: { count: 2, matrices: [...identity, ...identity.map((v, i) => i === 12 ? 5 : v)], colours: null }, castShadow: false, receiveShadow: false }],
  sprites: [], lamps: [{ at: [0, 2, 0], colour: [1, 0.6, 0.3], intensity: 4, distance: 9 }],
  water: [{ id: 'pond', kind: 'pool', level: -0.2, shape: { kind: 'polygon', points: [[0, 0], [4, 0], [4, 4], [0, 4]] } }] as unknown as DevPart['water'],
});
const moved = (keys: string[]): DevPart => ({ ...hut([1, 1, 1]), lamps: [], water: [], geometries: keys.map(geometry), draws: keys.map(key => ({ geometry: key, material: 'roof', matrix: identity, instances: null, castShadow: false, receiveShadow: false })) });
const meshes = (root: THREE.Object3D): THREE.Mesh[] => { const out: THREE.Mesh[] = []; root.traverse(o => { if (o instanceof THREE.Mesh) out.push(o as THREE.Mesh); }); return out; };
const lights = (root: THREE.Object3D): number => { let n = 0; root.traverse(o => { if (o instanceof THREE.PointLight) n++; }); return n; };
const key = (fog: number): LookKey => ({ time: 0, sky: { zenith: [0.4, 0.5, 0.7], horizon: [0.7, 0.7, 0.7] }, fog: { colour: [0.7, 0.7, 0.7], density: fog }, sun: { colour: [1, 1, 1], intensity: 2 }, ambient: { sky: [0.5, 0.5, 0.6], ground: [0.3, 0.3, 0.2], intensity: 1 } });

async function page(): Promise<{ ports: DevHookPorts; physics: Physics; served: [string, number][]; liveKeys: LookKey[][]; frames: Set<(dt: number) => void> }> {
  const R = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../../../../node_modules/@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm', import.meta.url))));
  const physics = new Physics(R), served: [string, number][] = [], liveKeys: LookKey[][] = [], frames = new Set<(dt: number) => void>();
  const look = { compose: () => ({ chain: [] }), liveKeys: (keys: readonly LookKey[]) => { liveKeys.push([...keys]); return keys[0]?.fog.near === undefined; } } as unknown as LookStrategy;
  const ports: DevHookPorts = { scope: new Scope('test.devHook'), scene: new THREE.Scene(), physics, look: () => look,
    server: () => (name, boxes) => { served.push([name, boxes.length]); }, watchFrames: fn => { frames.add(fn); return () => { frames.delete(fn); }; } };
  return { ports, physics, served, liveKeys, frames };
}

test('AP5: the five hook calls: add, replace (new first, old scope gone, shared rasters kept), remove, set look, swap colliders', async () => {
  const { ports, physics, served, liveKeys } = await page(), hook = createDevHook(ports);
  expect(hook.version).toBe(DEV_HOOK_VERSION);
  const colliders = (): number => { let n = 0; physics.world.forEachCollider(() => { n++; }); return n; };
  const player = physics.world.createRigidBody(physics.R.RigidBodyDesc.kinematicPositionBased().setTranslation(3, 1, -2));

  // add: the draws, the look's lamp light and the client's water surface, all under the part
  hook.addPart('hut', hut([1, 0, 0]));
  expect(() => { hook.addPart('hut', hut([1, 0, 0])); }).toThrow('already drawn');
  expect(hook.root.children).toHaveLength(1);
  expect(meshes(hook.root).filter(m => m.name.startsWith('water:'))).toHaveLength(1);
  expect(meshes(hook.root)).toHaveLength(3);
  expect(lights(hook.root)).toBe(1);
  const before = meshes(hook.root)[0]?.material as THREE.MeshStandardMaterial;
  expect(before.color.getHex()).toBe(0xff0000);
  expect(before.map?.repeat.x).toBe(2);
  let disposed = 0; before.addEventListener('dispose', () => { disposed++; });
  const shared = meshes(hook.root)[0]?.geometry; let geometryDisposed = 0; shared?.addEventListener('dispose', () => { geometryDisposed++; });

  // replace: one call, the old part's scope disposed, the geometry (same key) not re-made
  hook.replacePart('hut', hut([0, 0, 1]));
  expect(hook.root.children).toHaveLength(1);
  const after = meshes(hook.root)[0]?.material as THREE.MeshStandardMaterial;
  expect(after.color.getHex()).toBe(0x0000ff);
  expect(disposed).toBe(1);
  expect(geometryDisposed).toBe(0);
  expect(meshes(hook.root)[0]?.geometry).toBe(shared);
  expect(lights(hook.root)).toBe(1);
  expect(hook.held()).toEqual({ geometries: 1, textures: 1 });

  // swap colliders: the page's world and the server's half, new set first; an empty set removes them
  const wall: DevBox = { centre: [0, 0.5, 0], half: [1, 0.5, 1], rotation: [0, 0, 0, 1] };
  hook.swapColliders('hut', [wall]);
  hook.swapColliders('hut', [wall, { ...wall, centre: [3, 0.5, 0] }]);
  expect(colliders()).toBe(2);
  hook.swapColliders('hut', []);
  expect(colliders()).toBe(0);
  expect(served).toEqual([['hut', 1], ['hut', 2], ['hut', 0]]);

  // set look: the look's day keys in place; a fog kind change can't go live
  expect(hook.setLook({ keys: [key(0.02)] })).toBe(true);
  expect(hook.setLook({ keys: [{ ...key(0), fog: { colour: [1, 1, 1], density: 0, near: 5, far: 50 } }] })).toBe(false);
  expect(liveKeys).toHaveLength(2);

  // remove: everything the part held goes
  hook.removePart('hut');
  expect(hook.root.children).toHaveLength(0);
  expect(geometryDisposed).toBe(1);
  expect(hook.held()).toEqual({ geometries: 0, textures: 0 });
  expect(player.translation()).toEqual({ x: 3, y: 1, z: -2 });
  ports.scope.dispose();
  expect((ports.scene as THREE.Scene).children).toHaveLength(0);
});

test('AP5: a geometry that moves between parts survives; a part that fails to build leaves the old one drawn and nothing held', async () => {
  const { ports } = await page(), hook = createDevHook({ ...ports, physics: null });
  hook.addPart('a', moved(['g1'])); hook.addPart('b', moved(['g2']));
  hook.replacePart('b', moved(['g1'])); hook.replacePart('a', moved(['g2']));
  expect(hook.held()).toEqual({ geometries: 2, textures: 1 });
  const broken: DevPart = { ...moved(['g3']), draws: [{ geometry: 'g3', material: 'missing', matrix: identity, instances: null, castShadow: false, receiveShadow: false }] };
  expect(() => { hook.replacePart('a', broken); }).toThrow('names material missing');
  expect(hook.held()).toEqual({ geometries: 2, textures: 1 });
  expect(hook.root.children).toHaveLength(2);
  hook.removePart('a'); hook.removePart('b');
  expect(hook.held()).toEqual({ geometries: 0, textures: 0 });
  ports.scope.dispose();
});

test('AP5: the in-page server takes the same boxes from the harness port message, and refuses a malformed one', async () => {
  const { physics } = await page(), scope = new Scope('test.devBoxes'), held = new Map<string, Scope>();
  const message: unknown = { wildshardDevColliders: 'hut', boxes: [{ centre: [0, 1, 0], half: [1, 1, 1], rotation: [0, 0, 0, 1] }] };
  expect(isDevColliders(message)).toBe(true);
  expect(isDevColliders({ wildshardDevColliders: 'hut', boxes: [{ centre: [0, 1], half: [1, 1, 1], rotation: [0, 0, 0, 1] }] })).toBe(false);
  if (!isDevColliders(message)) return;
  swapDevBoxes(physics, scope, held, message.wildshardDevColliders, message.boxes);
  let n = 0; physics.world.forEachCollider(() => { n++; });
  expect(n).toBe(1);
  scope.dispose();
  n = 0; physics.world.forEachCollider(() => { n++; });
  expect(n).toBe(0);
});

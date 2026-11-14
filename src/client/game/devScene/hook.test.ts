import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { Physics } from '@wildshard/engine/physics/Physics';
import type { LookKey } from '@wildshard/engine/render/dataLook';
import type { LookStrategy } from '@wildshard/engine/render/look';
import { createDevHook, DEV_HOOK_VERSION, type DevGeometry, type DevHookPorts, type DevPart } from './hook';
import { isDevColliders, isDevGround, liftedFeet, swapDevBoxes, swapDevGround, type DevBox, type DevGround } from '@wildshard/engine/game/devColliders';
import { addBakedTerrainCollider } from '@wildshard/engine/physics/terrainTiles';
import { isTerrainCollider } from '@wildshard/engine/physics/surface';
import { installTerrainTile } from '@wildshard/engine/world/terrainTileView';
import { encodeTerrainTile, type TerrainTileData } from '@wildshard/format/terrainTileBytes';

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
  const ports: DevHookPorts = { scope: new Scope('test.devHook'), scene: new THREE.Scene(), physics: () => physics, look: () => look,
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
  const { ports } = await page(), hook = createDevHook({ ...ports, physics: () => null });
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

test('AP5: after a grid crossing swaps the page world, the held parts\' boxes are made again in the new world', async () => {
  const { ports, physics } = await page(), next = new Physics(physics.R);
  let world = physics;
  const hook = createDevHook({ ...ports, physics: () => world });
  const count = (p: Physics): number => { let n = 0; p.world.forEachCollider(() => { n++; }); return n; };
  const solid = { centre: [0, 1, 0], half: [1, 1, 1], rotation: [0, 0, 0, 1] } as const;
  hook.swapColliders('hut', [solid]); hook.swapColliders('wall', [solid, solid]);
  expect(count(physics)).toBe(3);
  world = next;
  hook.swapColliders('wall', [solid]);
  expect([count(physics), count(next)]).toEqual([0, 2]);
  expect(() => { hook.swapColliders('wall', [{ ...solid, half: [0, 1, 1] }]); }).toThrow('malformed collider box');
  ports.scope.dispose();
  expect(count(next)).toBe(0);
});

/** A whole-ground lattice as sharddev's bake makes one (257², 500 m), and a tile cut from it as the bake cuts one. */
const lattice = (heightAt: (x: number, z: number) => number, tint = 0.3): TerrainTileData => {
  const heights = new Float32Array(257 ** 2), colours = new Float32Array(257 ** 2 * 3);
  for (let z = 0; z < 257; z++) for (let x = 0; x < 257; x++) { heights[z * 257 + x] = heightAt(-250 + x * 500 / 256, -250 + z * 500 / 256); colours.set([tint, 0.4, 0.2], (z * 257 + x) * 3); }
  return { resolution: 257, x: -250, z: -250, size: 500, heights, colours };
};
const tileOf = (whole: TerrainTileData, lod: 0 | 1, tx: number, tz: number): TerrainTileData => {
  const size = lod === 0 ? 62.5 : 125, resolution = lod === 0 ? 33 : 17, stride = lod === 0 ? 1 : 4;
  const heights = new Float32Array(resolution ** 2), colours = new Float32Array(resolution ** 2 * 3);
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
    const g = (tz * size / (500 / 256) + z * stride) * 257 + tx * size / (500 / 256) + x * stride;
    heights[z * resolution + x] = whole.heights[g] ?? 0; colours.set((whole.colours ?? new Float32Array(0)).subarray(g * 3, g * 3 + 3), (z * resolution + x) * 3);
  }
  return { resolution, x: -250 + tx * size, z: -250 + tz * size, size, heights, colours };
};
const hill = (cx: number, cz: number, height: number) => (x: number, z: number): number => height * Math.max(0, 1 - Math.hypot(x - cx, z - cz) / 20);
const groundUnder = (physics: Physics, x: number, z: number): number | null => {
  physics.world.step(); // the scene queries see the swapped colliders after a step, as the page's next frame does
  const hit = physics.world.castRay(new physics.R.Ray({ x, y: 80, z }, { x: 0, y: -1, z: 0 }), 200, true);
  return hit === null ? null : 80 - hit.timeOfImpact;
};
const terrainColliders = (physics: Physics): number => { let n = 0; physics.world.forEachCollider(c => { if (isTerrainCollider(c)) n++; }); return n; };

test('AP18: a new ground swaps the page collider and the changed tiles (as a fresh tile would draw them), lifts the player and goes to the server', async () => {
  const { ports, physics } = await page(), flat = lattice(() => 0), boot = new Scope('test.boot');
  const heightsOnly = (whole: TerrainTileData): DevGround => ({ resolution: whole.resolution, x: whole.x, z: whole.z, size: whole.size, heights: whole.heights });
  addBakedTerrainCollider(physics, encodeTerrainTile(heightsOnly(flat)), boot);
  const material = new THREE.MeshStandardMaterial(), at = (lod: 0 | 1, tx: number, tz: number, whole: TerrainTileData, root: THREE.Object3D, scope: Scope): THREE.Mesh =>
    installTerrainTile(tileOf(whole, lod, tx, tz), { root, scope, material, shadow: false, lattice: whole });
  // the boot's tiles: the L0 under the player (4, 4: x 0 to 62.5), a far L0 (0, 0) and the L1 under the player (2, 2)
  const near = at(0, 4, 4, flat, ports.scene, boot), far = at(0, 0, 0, flat, ports.scene, boot), coarse = at(1, 2, 2, flat, ports.scene, boot);
  const placed: number[][] = [], served: DevGround[] = [];
  const player = { position: new THREE.Vector3(10, 0, 10), yaw: 0.3, pitch: 0.2, spawn: (x: number, z: number, yaw: number, y?: number) => { placed.push([x, z, yaw, y ?? Number.NaN]); player.position.set(x, y ?? 0, z); player.pitch = 0; } };
  const hook = createDevHook({ ...ports, player: () => player, serverGround: () => (ground) => { served.push(ground); } });
  expect(groundUnder(physics, 10, 10)).toBeCloseTo(0, 3);

  const raised = lattice(hill(10, 10, 5));
  expect(hook.setGround(encodeTerrainTile(raised))).toBe(true);
  // one ground collider, the new one: the player's feet are on the hill
  expect(terrainColliders(physics)).toBe(1);
  expect(groundUnder(physics, 10, 10)).toBeGreaterThan(4.5);
  expect(placed).toHaveLength(1);
  expect(placed[0]?.[3]).toBeGreaterThan(4.5);
  expect(player.pitch).toBe(0.2);
  expect(served.map(g => g.heights.length)).toEqual([257 ** 2]);
  // each tile's vertices are a fresh tile's, cut from the new ground
  const scratch = new Scope('test.fresh'), fresh = new THREE.Group();
  for (const [mesh, lod, tx, tz] of [[near, 0, 4, 4], [coarse, 1, 2, 2], [far, 0, 0, 0]] as const) {
    const truth = at(lod, tx, tz, raised, fresh, scratch);
    for (const name of ['position', 'normal', 'color']) expect(Array.from(mesh.geometry.getAttribute(name).array)).toEqual(Array.from(truth.geometry.getAttribute(name).array));
  }
  scratch.dispose();

  // a change in one corner cuts only the tiles that hold it: the far tile, not the near one
  const versions = (): number[] => [near, far].map(mesh => (mesh.geometry.getAttribute('position') as THREE.BufferAttribute).version);
  const before = versions();
  expect(hook.setGround(encodeTerrainTile(lattice((x, z) => hill(10, 10, 5)(x, z) + hill(-240, -240, 3)(x, z))))).toBe(true);
  const after = versions();
  expect([after[0] === before[0], after[1] === before[1]]).toEqual([true, false]);
  expect(placed).toHaveLength(1); // already on the hill: no second lift
  expect(terrainColliders(physics)).toBe(1);
  // a colour edit alone cuts the tiles again
  expect(hook.setGround(encodeTerrainTile(lattice((x, z) => hill(10, 10, 5)(x, z) + hill(-240, -240, 3)(x, z), 0.6)))).toBe(true);
  expect(versions().every((v, i) => v !== after[i])).toBe(true);
  // a heights-only payload is no ground the tiles can be cut from
  expect(hook.setGround(encodeTerrainTile(heightsOnly(raised)))).toBe(false);
  ports.scope.dispose(); boot.dispose();
  expect(terrainColliders(physics)).toBe(0);
});

test('AP18: the in-page server swaps its heightfield and height query and lifts its players; a box lifts feet inside it', async () => {
  const { physics } = await page(), owner = new Scope('test.server'), held: { scope: Scope | null } = { scope: null };
  const raised = lattice(hill(0, 0, 4)), ground: DevGround = { resolution: 257, x: -250, z: -250, size: 500, heights: raised.heights };
  const message: unknown = { wildshardDevGround: ground };
  expect(isDevGround(message)).toBe(true);
  expect(isDevGround({ wildshardDevGround: { ...ground, heights: new Float32Array(4) } })).toBe(false);
  let query: ((x: number, z: number) => number) | null = null;
  const places: [string, number][] = [];
  const players = new Map([['me', { position: { x: 0, y: 0, z: 0 }, yaw: 1 }], ['far', { position: { x: 100, y: 0, z: 100 }, yaw: 0 }]]);
  swapDevGround(physics, owner, held, ground, { heightQuery: (h) => { query = h; }, players: () => players.entries(), place: (at, id) => { places.push([id, at.y]); } });
  swapDevGround(physics, owner, held, ground, { heightQuery: (h) => { query = h; }, players: () => [], place: () => undefined });
  expect(terrainColliders(physics)).toBe(1);
  expect((query as ((x: number, z: number) => number) | null)?.(0, 0)).toBeCloseTo(4, 1);
  expect(places.map(([id, y]) => [id, Math.round(y)])).toEqual([['me', 4]]);
  // a box: feet inside it stand on its top; a quarter turn about y keeps the top
  const crate: DevBox = { centre: [0, 1, 0], half: [2, 1, 2], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };
  expect(liftedFeet(0.5, 0.5, 0.5, null, [crate])).toBeCloseTo(2, 5);
  expect(liftedFeet(5, 0.5, 0, null, [crate])).toBeNull();
  owner.dispose();
  expect(terrainColliders(physics)).toBe(0);
});

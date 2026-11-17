import { expect, test } from 'vitest';
import { Bone, BufferAttribute, BufferGeometry, Color, DataTexture, Float32BufferAttribute, InstancedMesh, MeshStandardMaterial, Skeleton, SkinnedMesh, Vector3, type Material } from 'three';
import { CreatureLods, LOD_FRAMES, type LodRig, type LodSource, type LodTier } from './creatureLods';
import type { SpriteViews } from '../render/spriteViews';

const PHONE: LodTier = { baked: 40, hide: 150, sprite: 300 };

function rigMesh(): SkinnedMesh {
  const root = new Bone(), leg = new Bone(); leg.position.set(0, -0.5, 0); root.add(leg); root.position.set(0, 1, 0);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 1, 0, 0, 0.5, 0, 0.1, 0.5, 0], 3));
  geometry.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  mesh.add(root); mesh.updateMatrixWorld(true); mesh.bind(new Skeleton([root, leg]));
  return mesh;
}

interface Deer extends LodRig { gaitPhase: number; speed: number; alive: boolean; drawPinned: boolean }
const deer = (mesh: SkinnedMesh, z: number, speed = 1.2): Deer => ({
  mesh, position: new Vector3(0, 0, -z), yaw: 0.4, scale: 1, alive: true, fading: false, drawPinned: false, speed, gaitPhase: 0, poseFrozen: false,
});

function lods(opts: { material?: boolean; views?: boolean } = {}): { lods: CreatureLods<object>; model: object; made: Material[]; asked: () => number } {
  const made: Material[] = [], model = {}, mesh = rigMesh();
  let asks = 0;
  const views: SpriteViews = { texture: new DataTexture(new Uint8Array(4), 1, 1), views: 8, width: 2, height: 2, offsetY: 0 };
  const source: LodSource<object> = {
    geometry: () => mesh.geometry,
    material: () => { asks++; if (opts.material === false) return null; const m = new MeshStandardMaterial(); made.push(m); return m; },
    views: () => (opts.views === false ? null : views),
  };
  return { lods: new CreatureLods(source), model, made, asked: () => asks };
}

/** walk `rig` through every gait slot inside the live band */
function walkThrough(l: CreatureLods<object>, model: object, rig: Deer): void {
  for (let f = 0; f < LOD_FRAMES; f++) { rig.gaitPhase = (f + 0.5) / LOD_FRAMES; l.begin(); expect(l.draw(rig, model, 20 * 20, PHONE)).toBe('rig'); l.end(); }
}

test('far animals stay posed rigs until their model\'s gait is recorded, then one baked herd draws them', () => {
  const { lods: l, model, made } = lods();
  const near = deer(rigMesh(), 20), far = deer(rigMesh(), 90);
  expect(l.draw(far, model, 90 * 90, PHONE)).toBe('rig');
  expect(l.posesLive(far, model, 90 * 90, PHONE)).toBe(true);
  walkThrough(l, model, near);
  expect(made).toHaveLength(1);
  l.begin();
  expect(l.draw(far, model, 90 * 90, PHONE, new Color(0.8, 0.7, 0.6))).toBe('baked');
  expect(l.draw(near, model, 20 * 20, PHONE)).toBe('rig');
  l.end();
  expect(l.posesLive(far, model, 90 * 90, PHONE)).toBe(false);
  expect(l.posesLive(near, model, 20 * 20, PHONE)).toBe(true);
  const herd = l.group.children.find((c): c is InstancedMesh => c instanceof InstancedMesh);
  expect(herd?.count).toBe(1);
  expect(herd?.visible).toBe(true);
  l.begin(); l.end();
  expect(herd?.visible).toBe(false);
  l.dispose();
});

test('a standing rig records nothing; corpses, fading and pinned bodies are always rigs', () => {
  const { lods: l, model, made } = lods();
  walkThrough(l, model, deer(rigMesh(), 20, 0));
  expect(made).toHaveLength(0);
  walkThrough(l, model, deer(rigMesh(), 20));
  const dead = { ...deer(rigMesh(), 90), alive: false }, pinned = { ...deer(rigMesh(), 90), drawPinned: true };
  for (const a of [dead, pinned]) { expect(l.draw(a, model, 90 * 90, PHONE)).toBe('rig'); expect(l.posesLive(a, model, 90 * 90, PHONE)).toBe(true); }
});

test('a rig whose bones the cadence froze this frame records nothing', () => {
  const { lods: l, model, made } = lods();
  walkThrough(l, model, { ...deer(rigMesh(), 20), poseFrozen: true });
  expect(made).toHaveLength(0);
});

test('a look the herd cannot draw keeps its rigs, and is asked once', () => {
  const { lods: l, model, asked } = lods({ material: false });
  walkThrough(l, model, deer(rigMesh(), 20));
  walkThrough(l, model, deer(rigMesh(), 20));
  expect(asked()).toBe(1);
  expect(l.draw(deer(rigMesh(), 90), model, 90 * 90, PHONE)).toBe('rig');
  expect(l.baked(model)).toBe(false);
});

test('past the hide distance cards draw the herd to the card distance, fading out over its last 15 %', () => {
  const { lods: l, model } = lods();
  const a = deer(rigMesh(), 200);
  l.begin();
  expect(l.draw(a, model, 200 * 200, PHONE)).toBe('card');
  expect(l.draw(deer(rigMesh(), 290), model, 290 * 290, PHONE)).toBe('card');
  expect(l.draw(deer(rigMesh(), 310), model, 310 * 310, PHONE)).toBe('none');
  l.end();
  expect(l.posesLive(a, model, 200 * 200, PHONE)).toBe(false);
  const cards = l.group.children.find((c): c is InstancedMesh => c instanceof InstancedMesh);
  expect(cards?.count).toBe(2);
  const scale = (i: number): number => { const m = new Float32Array(16); cards?.instanceMatrix.array.slice(i * 16, i * 16 + 16).forEach((v, k) => { m[k] = v; }); return Math.hypot(m[0] ?? 0, m[1] ?? 0, m[2] ?? 0); };
  expect(scale(0)).toBeCloseTo(1);
  expect(scale(1)).toBeLessThan(0.5);
  // no cards on a tier without the band, or for a model with no views
  expect(l.draw(a, model, 200 * 200, { ...PHONE, sprite: 0 })).toBe('none');
  const { lods: blind, model: m2 } = lods({ views: false });
  expect(blind.draw(a, m2, 200 * 200, PHONE)).toBe('none');
});

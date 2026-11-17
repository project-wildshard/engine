// oxlint-disable-next-line import/no-nodejs-modules -- the golden vectors ship as JSON files in the format package
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- resolve the package's golden file by its export
import { createRequire } from 'node:module';
import { expect, test } from 'vitest';
import * as forestLaw from '@wildshard/format/forestPlacement';
import * as colliderLaw from '@wildshard/format/colliders';
import * as seeded from '@wildshard/format/seededRng';
import * as noiseLaw from '@wildshard/format/noise';
import * as fieldLaw from '@wildshard/format/terrainField';
import { fixtureBytes } from '../../test/engine/nativeBytes';
import { Rng, RngService, fnv1a32, type RngPort, type RngState } from './core/rng';
import { Noise2D } from './core/noise';
import { buildTerrain } from './world/terrainField';
import { placeForest } from './world/forest/placement';
import { loadRapier } from './physics/rapier';
import { Physics } from './physics/Physics';
import { addPiece } from './physics/pieces';
import { placeCollider, poseOf } from '../../client/engine/models/colliders';
import type { ColliderDesc } from '../../client/engine/world/registry';

/**
 * SDK-SPLIT SP5d (Q35): the engine's runtime paths answer format's laws bit for bit. The sim's RNG replays format's golden
 * vectors (drawn from the engine before the move); forest placement and collider placement run through the engine's own
 * wrappers (THREE.Color tints, three's Matrix4 and Quaternion) and give format's numbers, and the placed colliders reach
 * Rapier's descriptors unchanged.
 */
const bits = (value: number): string => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
};
interface Draws { next: string[]; range: string; int: number; pick: string; chance: boolean; weighted: string; state: RngState }
interface RngGolden { cases: { seed: number; first: Draws; numberFork: Draws; stringFork: Draws; scrambled: Draws; scrambledFork: Draws }[]; hashes: { text: string; hash: number }[] }
const golden = JSON.parse(readFileSync(createRequire(import.meta.url).resolve('@wildshard/format/seeded-rng.golden.json'), 'utf8')) as RngGolden;
function draw(rng: RngPort): Draws {
  return { next: Array.from({ length: 8 }, () => bits(rng.next())), range: bits(rng.range(-3.5, 7.25)), int: rng.int(-10, 10),
    pick: rng.pick(['a', 'b', 'c', 'd', 'e']), chance: rng.chance(0.37), weighted: rng.weighted([['x', 1], ['y', 2.5], ['z', 0.5]]), state: rng.snapshot() };
}

test('the engine RNG and the sim streams replay format golden draws', () => {
  expect(golden.cases.length).toBeGreaterThanOrEqual(7);
  for (const want of golden.cases) {
    const plain = new Rng(want.seed);
    expect(draw(plain)).toEqual(want.first);
    expect(draw(plain.fork(3))).toEqual(want.numberFork);
    expect(draw(plain.fork('trees'))).toEqual(want.stringFork);
    const scrambled = Rng.scrambled(want.seed);
    expect(draw(scrambled)).toEqual(want.scrambled);
    expect(draw(scrambled.fork(7))).toEqual(want.scrambledFork);
    const streams = new RngService(want.seed);
    expect(draw(streams.stream('gameplay'))).toEqual(draw(new seeded.Rng(seeded.fnv1a32(`${String(want.seed)}:gameplay`))));
  }
  for (const { text, hash } of golden.hashes) expect(fnv1a32(text)).toBe(hash);
});

test('noise and the terrain field are format laws, not engine copies', () => {
  expect(Object.getPrototypeOf(Noise2D)).toBe(noiseLaw.Noise2D);
  expect(Object.getPrototypeOf(Rng)).toBe(seeded.Rng);
  expect(buildTerrain).toBe(fieldLaw.buildTerrain);
  const engine = new Noise2D(5), format = new noiseLaw.Noise2D(5);
  for (let i = 0; i < 64; i++) expect(bits(engine.fbm(i * 1.37, i * -0.91))).toBe(bits(format.fbm(i * 1.37, i * -0.91)));
});

test('engine forest placement gives format trees, tints as THREE.Color', () => {
  const forest = { spacing: 9, densityFreq: 0.03, clearings: [-0.7, 0.2] as [number, number], maxSlope: 0.8, tintHue: 0.25, tintHueJitter: [-0.01, 0.02] as [number, number],
    tintSat: [0.4, 0.7] as [number, number], tintLight: [0.5, 0.8] as [number, number], largeVariantChance: 0.2 };
  const terrain = buildTerrain(77, { landscape: (x, z, n) => 6 * n.n.fbm(x * 0.01, z * 0.01), trails: [[[-200, -10], [200, 30]]], cabinSites: [{ x: 40, z: -60, rot: 0.3 }] });
  const source = { ...terrain, seed: 77, treeCount: 60, forest };
  const variants = Array.from({ length: 4 }, (_, i) => ({ trunkRadius: 0.2 + i * 0.1, height: 5 + i }));
  const engine = placeForest(variants, source).trees, format = forestLaw.placeForest(variants, source).trees;
  expect(engine.length).toBeGreaterThan(20);
  expect(engine.map(t => [t.x, t.y, t.z, t.r, t.variant, t.scale, t.rot, t.height, ...t.tint.toArray()].map(bits)))
    .toEqual(format.map(t => [t.x, t.y, t.z, t.r, t.variant, t.scale, t.rot, t.height, ...t.tint].map(bits)));
});

test('engine collider placement gives format numbers, and Rapier receives them', async () => {
  const R = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../../../node_modules/@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm', import.meta.url))));
  const physics = new Physics(R);
  const own: ColliderDesc[] = [{ kind: 'box', x: 1, y: 2, z: 3, hx: 1, hy: 0.5, hz: 2, yaw: 0.4 }, { kind: 'capsule', x: -2, y: 1, z: 0, halfHeight: 1.2, radius: 0.4 },
    { kind: 'ball', x: 0, y: 3, z: 1, radius: 0.7 }];
  try {
    for (const placement of [{ x: 12.5, y: -3, z: 7.25, scale: 1.75 }, { x: 3, y: 4, z: 5, yaw: -2.3, leanX: 0.15, leanZ: -0.08, scale: 0.6 }, { x: -40, y: 2, z: 19, yaw: 1.2 }]) {
      const pose = poseOf(placement), want = colliderLaw.poseOf(placement);
      expect(pose.matrix.elements.map(bits)).toEqual([...want.matrix].map(bits));
      expect([pose.quat.x, pose.quat.y, pose.quat.z, pose.quat.w, pose.scale].map(bits)).toEqual([want.quat.x, want.quat.y, want.quat.z, want.quat.w, want.scale].map(bits));
      for (const desc of own) {
        const placed = placeCollider(desc, pose);
        expect(placed).toEqual(colliderLaw.placeCollider(desc, want));
        const added = addPiece(physics, { id: 'p', name: 'p', file: 'fixture', category: 'props', surface: 'stone', colliders: [placed] }).colliders[0];
        if (added === undefined) throw new Error('Missing native collider');
        if (placed.kind !== 'box' && placed.kind !== 'capsule' && placed.kind !== 'ball') throw new Error('Unexpected placed kind');
        expect(added.translation()).toEqual({ x: Math.fround(placed.x), y: Math.fround(placed.y), z: Math.fround(placed.z) });
      }
    }
  } finally { physics.dispose(); }
});

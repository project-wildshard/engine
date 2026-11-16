import * as THREE from 'three';
import { expect, test } from 'vitest';
import type { ShardWater } from '@wildshard/format/water';
import { installClientSplash, splashPools } from './clientSplash';

// Meta SHARD-SOURCE SS6: a scene pool (one with a surface) splashes on the page; other water is its owner's.

const surface = { reflect: 'planar', tint: [0.1, 0.2, 0.3], fresnel: [0.35, 3], ripple: { scale: 3, amplitude: 0.002, speed: 1 }, resolution: 512 };
const water = [
  { id: 'scene.pond.water', kind: 'pool', level: 0.2, shape: { kind: 'polygon', points: [[-4, -4], [4, -4], [4, 4], [-4, 4]] }, surface },
  { id: 'round', kind: 'pool', level: 0, shape: { kind: 'circle', x: 20, z: 0, radius: 3 }, surface },
  { id: 'habitat', kind: 'pool', level: 0, shape: { kind: 'circle', x: -20, z: 0, radius: 3 } },
] as unknown as ShardWater;

test('scene pools become splash outlines; a pool with no surface does not', () => {
  const pools = splashPools(water);
  expect(pools.map((p) => p.id)).toEqual(['scene.pond.water', 'round']);
  expect(pools[1]?.outline).toHaveLength(24);
  expect(pools[1]?.outline[0]).toEqual([23, 0]);
});

test('the player walking into the pond splashes; the scope takes it away', () => {
  const root = new THREE.Group(), disposers: (() => void)[] = [], frames: ((dt: number) => void)[] = [];
  let x = -6;
  const splash = installClientSplash(water, { root, scope: { onDispose: (run: () => void) => { disposers.push(run); } } as never, phone: false,
    movers: () => [{ id: 'player', x, y: 0.2, z: 0 }], frame: (run) => { frames.push(run); } });
  expect(root.children.map((c) => c.name)).toEqual(['water:splash', 'water:rings']);
  for (; x < -2; x += 0.1) for (const run of frames) run(1 / 60);
  expect(splash?.live().rings).toBe(1);
  for (const run of disposers) run();
  expect(root.children).toHaveLength(0);
  expect(installClientSplash([], { root, scope: { onDispose: () => undefined } as never, phone: false, movers: () => [], frame: () => undefined })).toBeNull();
});

test('a creature wading in splashes on its own while the player stands dry (SS6c)', () => {
  const root = new THREE.Group(), frames: ((dt: number) => void)[] = [];
  let x = -6;
  const splash = installClientSplash(water, { root, scope: { onDispose: () => undefined } as never, phone: false,
    movers: () => [{ id: 'player', x: -9, y: 0.2, z: 0 }, { id: 'heron', x, y: 0.2, z: 1 }], frame: (run) => { frames.push(run); } });
  for (; x < -2; x += 0.1) for (const run of frames) run(1 / 60);
  expect(splash?.live().rings).toBe(1);
  expect(splash?.live().drops).toBeGreaterThan(10);
});

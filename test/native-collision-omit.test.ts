// oxlint-disable-next-line import/no-nodejs-modules -- Install real colliders with the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { Physics } from '@wildshard/engine/physics/Physics';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { tagOf } from '@wildshard/engine/physics/surface';
import { installNativeCollision, type NativeCollisionSolid } from '@wildshard/engine/game/population/nativeBake';

// A grid admission names the baked materials it leaves out (Pine's entry proof drops the standalone rim slabs, `edge`);
// the standalone install of the same bake keeps every solid.
test('a native bake install leaves out exactly the solids of its omitted materials', async () => {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const box = (x: number, material: NativeCollisionSolid['material']): NativeCollisionSolid => ({ shape: 1, groups: 0xffff, friction: 0.5,
    at: [x, 1, 0], rot: [0, 0, 0, 1], half: [1, 1, 1], ...(material === undefined ? {} : { material }) });
  const bake = { ground: { heights: new Float32Array(4), friction: 0.5, groups: 0xffff, scale: { x: 10, y: 1, z: 10 }, at: { x: 0, y: 0, z: 0 } },
    solids: [box(250, 'edge'), box(-250, 'edge'), box(3, 'wood'), box(6, undefined)] };
  const materials = (omit?: NativeCollisionSolid['material'][]): string[] => {
    const scope = new Scope('native-collision'), physics = new Physics(R), seen: string[] = [];
    try {
      installNativeCollision({ physics, scope, onStep: () => () => undefined }, bake, { resolution: 2, ...(omit === undefined ? {} : { omit: omit.filter(m => m !== undefined) }) });
      physics.world.forEachCollider(collider => { seen.push(tagOf(collider)?.material ?? 'untagged'); });
      return seen.sort();
    } finally { scope.dispose(); }
  };
  expect(materials()).toEqual(['edge', 'edge', 'ground', 'untagged', 'wood']);
  expect(materials(['edge'])).toEqual(['ground', 'untagged', 'wood']);
});

// GRID-CROSSING GC36 (J322, no walls): an older bake holds its page's four chunk-edge walls, Nalati's with no material; an `edge` omit
// names them by their shape too, and keeps a box of any other shape or place.
test('an edge omit leaves out a bake\'s untagged chunk-edge walls and nothing else', async () => {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const wall = (at: [number, number, number], half: [number, number, number]): NativeCollisionSolid => ({ shape: 1, groups: 0xffff, friction: 0.5, at, rot: [0, 0, 0, 1], half });
  const bake = { ground: { heights: new Float32Array(4), friction: 0.5, groups: 0xffff, scale: { x: 10, y: 1, z: 10 }, at: { x: 0, y: 0, z: 0 } },
    solids: [wall([250.2, 170, 0], [1, 230, 252]), wall([-250.2, 170, 0], [1, 230, 252]), wall([0, 170, 250.2], [252, 230, 1]), wall([0, 170, -250.2], [252, 230, 1]),
      wall([240, 170, 0], [1, 230, 252]), wall([250.2, 1, 0], [1, 1, 1])] };
  const scope = new Scope('native-collision'), physics = new Physics(R);
  try {
    installNativeCollision({ physics, scope, onStep: () => () => undefined }, bake, { resolution: 2, omit: ['edge'] });
    const xs: number[] = [];
    physics.world.forEachCollider(collider => { if (tagOf(collider)?.material !== 'ground') xs.push(Math.round(collider.translation().x)); });
    expect(xs.sort((a, b) => a - b)).toEqual([240, 250]);
  } finally { scope.dispose(); }
});

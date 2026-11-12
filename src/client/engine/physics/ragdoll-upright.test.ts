/**
 * TE-ENG11: a custom rig's tossed corpse (the `rigid` ragdoll: one box, thrown and spun by the killing hit) rests the
 * right way up on flat ground. Brasscap's beaten Dust Wyrm landed on its head (mesh rotation x ≈ π): the spin about
 * (up × away) turned the box over in the air and nothing turned it back, so a body landed on whichever face it hit.
 * The species' die clip owns the corpse's pose; the physics throws it and lays it down on its base.
 */
import { expect, test } from 'vitest';
import * as THREE from 'three';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { loadRapier } from '../../../shared/engine/physics/rapier';
import { Physics } from '../../../shared/engine/physics/Physics';
import { Ragdolls, type RagdollDims } from './ragdoll';

const R = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../../../../public/assets/physics/rapier.wasm', import.meta.url))));

/** the custom rigs that take the `rigid` build (no capsuleAxis 'y'): Brasscap's Wyrm and bandit, Driftwood's crab */
const BODIES: readonly { name: string; dims: RagdollDims; scale: number }[] = [
  { name: 'Brasscap Dust Wyrm', dims: { bodyY: 0.9, bodyHalfLen: 0.4, bodyRadius: 0.45, headRadius: 0.36, halfWidth: 0.45 }, scale: 2 },
  { name: 'Brasscap tin bandit', dims: { bodyY: 0.62, bodyHalfLen: 0.3, bodyRadius: 0.36, headRadius: 0.22, halfWidth: 0.36 }, scale: 1 },
  { name: 'Driftwood reef crab', dims: { bodyY: 0.2, bodyHalfLen: 0.22, bodyRadius: 0.3, headRadius: 0.09, halfWidth: 0.36 }, scale: 1 },
];
const COS_30 = Math.cos(Math.PI / 6);

/** Kill a body standing at the origin of a flat floor, step until the corpse freezes; its up vector's dot with world up. */
function restingUp(dims: RagdollDims, scale: number, dir: THREE.Vector3, damage: number, yaw: number, slope = 0, opts: { inverted?: boolean; stepsPerPose?: number } = {}): number {
  const p = new Physics(R);
  // the floor's top face through the origin, tilted `slope` rad about x
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), slope), under = new THREE.Vector3(0, -0.5, 0).applyQuaternion(tilt);
  p.world.createCollider(R.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(under.x, under.y, under.z).setRotation(tilt));
  const root = new THREE.Group();
  root.scale.setScalar(scale); root.rotation.set(opts.inverted === true ? Math.PI : 0, yaw, 0);
  // inverted: on its head on the floor (the box hangs below the root, 1.1 × bodyY deep)
  if (opts.inverted === true) root.position.y = dims.bodyY * 1.1 * scale;
  root.updateMatrixWorld(true);
  const ragdoll = new Ragdolls(p, 6).spawn({ build: 'rigid', root, bones: {}, dims, scale, lite: false,
    velocity: { x: 0, y: 0, z: 0 }, hitPoint: { x: 0, y: dims.bodyY * scale, z: 0 }, dir, damage });
  if (ragdoll === null) throw new Error('ragdoll cap');
  let steps = 0;
  const per = opts.stepsPerPose ?? 1;
  for (; steps < 60 * 8 && ragdoll.state === 'live'; steps += per) { for (let k = 0; k < per; k++) p.step(); ragdoll.pose(per / 60); }
  expect(ragdoll.state).toBe('frozen');
  // it came to rest on its own, not frozen mid-roll at the ragdoll's 5 s limit
  expect(steps).toBeLessThan(60 * 4.5);
  return new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion).dot(new THREE.Vector3(0, 1, 0).applyQuaternion(tilt));
}

for (const body of BODIES) {
  test(`a killed ${body.name} rests within 30° of upright on flat ground`, () => {
    const worst: number[] = [];
    for (const damage of [1, 8, 40, 80]) for (const a of [0, 1, 2, 3, 4, 5]) {
      const ang = a * Math.PI / 3;
      // the hit from level and from above (the rifle from the porch, a slam down)
      for (const dy of [0, -0.5]) worst.push(restingUp(body.dims, body.scale, new THREE.Vector3(Math.sin(ang), dy, Math.cos(ang)).normalize(), damage, ang * 0.7));
    }
    expect(Math.min(...worst)).toBeGreaterThan(COS_30);
  });
}

test('a killed Brasscap Dust Wyrm on a 26° slope rests on its base, square to the ground', () => {
  const worst: number[] = [];
  for (const damage of [8, 80]) for (const a of [0, 1, 2, 3, 4, 5]) {
    const ang = a * Math.PI / 3, body = BODIES[0];
    if (body === undefined) throw new Error('no Wyrm');
    worst.push(restingUp(body.dims, body.scale, new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)), damage, ang, 26 * Math.PI / 180));
  }
  expect(Math.min(...worst)).toBeGreaterThan(COS_30);
});

test('a body that dies on its head, or at a slow frame rate (two fixed steps a frame), still rests on its base', () => {
  const worst: number[] = [];
  for (const body of BODIES) for (const a of [0, 2, 4]) {
    const ang = a * Math.PI / 3, dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
    worst.push(restingUp(body.dims, body.scale, dir, 8, ang, 0, { inverted: true }));
    worst.push(restingUp(body.dims, body.scale, dir, 8, ang, 0, { stepsPerPose: 2 }));
  }
  expect(Math.min(...worst)).toBeGreaterThan(COS_30);
});

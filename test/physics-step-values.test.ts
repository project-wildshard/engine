// oxlint-disable-next-line import/no-nodejs-modules -- Use the real shipped native world, not a solver double.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare every serialized native world byte.
import { deepStrictEqual } from 'node:assert';
import { expect, test, vi } from 'vitest';
import { RawVector } from '@dimforge/rapier3d-simd/raw.js';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { Physics } from '../src/shared/engine/physics/Physics';

test('owned native gravity keeps every original evolving world byte and frees its one persistent vector', async () => {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))), old = new Physics(R), now = new Physics(R);
  for (const physics of [old, now]) {
    const w = physics.world;
    w.createCollider(R.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0));
    for (let i = 0; i < 12; i++) {
      const body = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(i % 3 - 1, 1 + Math.floor(i / 3), 0));
      w.createCollider(R.ColliderDesc.ball(0.4).setRestitution(0.1), body);
    }
  }
  const freed = vi.spyOn(RawVector.prototype, 'free'); let oldDisposed = false, nowDisposed = false;
  try {
    for (let tick = 0; tick < 1024; tick++) {
      for (const physics of [old, now]) {
        physics.world.gravity.x = Math.sin(tick * 0.013) * 0.15;
        physics.world.gravity.y = -9.81 + Math.cos(tick * 0.017) * 0.5;
        physics.world.gravity.z = Math.sin(tick * 0.019) * 0.1;
        physics.world.timestep = tick % 3 === 0 ? 1 / 120 : 1 / 60;
      }
      // Complete former Physics.step native operation at db20efec71: no event
      // queue or hooks are passed, and the soft-body refusal remains in source.
      const w = old.world;
      w.physicsPipeline.step(w.gravity, w.integrationParameters, w.islands, w.broadPhase, w.narrowPhase,
        w.bodies, w.colliders, w.softBodies, w.impulseJoints, w.multibodyJoints, w.ccdSolver);
      now.step(); deepStrictEqual(now.snapshot(), old.snapshot());
    }
    const count = freed.mock.calls.length; now.dispose(); nowDisposed = true;
    expect(freed.mock.calls.length - count).toBe(1);
    const after = freed.mock.calls.length; old.dispose(); oldDisposed = true; expect(freed.mock.calls.length).toBe(after);
  } finally { if (!oldDisposed) old.dispose(); if (!nowDisposed) now.dispose(); freed.mockRestore(); }
});

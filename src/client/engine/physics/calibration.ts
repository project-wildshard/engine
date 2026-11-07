/** Synthetic bodies and character controllers; Rapier remains inside the physics boundary. */
import { loadRapier } from '../../../shared/engine/physics/rapier';
import type { Collider, KinematicCharacterController } from '@dimforge/rapier3d-simd';

export async function calibrationBodies(n: number): Promise<{ run: () => void; dispose: () => void }> {
  const R = await loadRapier(), world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(R.ColliderDesc.cuboid(100, 0.1, 100));
  const controllers: { controller: KinematicCharacterController; collider: Collider }[] = [];
  for (let i = 0; i < n; i++) {
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation((i % 20) * 2, 1 + Math.floor(i / 20) * 2, 0));
    const collider = world.createCollider(R.ColliderDesc.capsule(0.3, 0.2), body);
    controllers.push({ controller: world.createCharacterController(0.01), collider });
  }
  return { run: () => { world.step(); for (const { controller, collider } of controllers) controller.computeColliderMovement(collider, { x: 0.01, y: 0, z: 0.01 }); }, dispose: () => { world.free(); } };
}

/** WASM-HOST H0 (H10's trigger): Rapier's per-call boundary for a ray query against 64 static boxes, and a kinematic pose
 *  sync (`setNextKinematicTranslation`) cycling 64 bodies; each takes a count and runs that many. */
export async function calibrationQueries(): Promise<{ rays: (n: number) => void; sync: (n: number) => void; dispose: () => void }> {
  const R = await loadRapier(), world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(R.ColliderDesc.cuboid(100, 0.1, 100));
  for (let i = 0; i < 64; i++) world.createCollider(R.ColliderDesc.cuboid(0.5, 1, 0.5).setTranslation((i % 8) * 4 - 14, 1, Math.floor(i / 8) * 4 - 14));
  const bodies = Array.from({ length: 64 }, (_, i) => world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(i, 3, 0)));
  world.step();
  const ray = new R.Ray({ x: 0, y: 1, z: -20 }, { x: 0, y: 0, z: 1 }), at = { x: 0, y: 3, z: 0 };
  return {
    rays: n => { for (let i = 0; i < n; i++) { ray.origin.x = (i % 64) * 0.5 - 16; world.castRay(ray, 60, true); } },
    sync: n => { for (let i = 0; i < n; i++) { at.x = i % 97; bodies[i % 64]?.setNextKinematicTranslation(at); } },
    dispose: () => { world.free(); },
  };
}

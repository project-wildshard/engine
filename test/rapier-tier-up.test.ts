// ENGINE-MEMORY EM21: Rapier's large optimizing compile belongs to the warm-up (the boot's data step), never to play.
// V8 optimizes Rapier's 366 kB step function (#2643 of 0.21's binary) on the second `world.step()`: about 190 MB of
// compile memory for about 0.3 s (node and Chromium alike; `--trace-wasm-compilation-times`). V8 counts that memory,
// which sits in its process-wide wasm engine, in every isolate's `malloced_memory`, so this file can watch it from here.
// The warm-up must trigger it, and every other large optimization, so a game world stepped afterwards compiles nothing big.
import { readFileSync } from 'node:fs';
import { getHeapStatistics } from 'node:v8';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { warmRapier } from '../src/shared/engine/physics/rapierWarm';

const malloced = (): number => getHeapStatistics().malloced_memory;
const MB = 1e6;

/** The largest rise over `base` seen every 10 ms while `work` runs and for `afterMs` after, until it stays near `base`. */
async function rise(base: number, work: () => void, afterMs: number): Promise<number> {
  let most = 0, quietSince = -1;
  const sample = (): void => { most = Math.max(most, malloced() - base); };
  const timer = setInterval(sample, 10);
  try {
    work(); sample();
    const start = performance.now();
    for (;;) {
      await sleep(10);
      const now = performance.now(), quiet = malloced() - base < 16 * MB;
      quietSince = quiet ? (quietSince < 0 ? now : quietSince) : -1;
      if (now - start > afterMs && quietSince >= 0 && now - quietSince > 300) return most;
      if (now - start > 20_000) return most;
    }
  } finally { clearInterval(timer); }
}

/** A game-shaped world unlike the warm-up's: more shapes, a joint, plain and normal ray casts, shape queries. */
function playWorld(R: Rapier): void {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  try {
    const n = 32, heights = new Float32Array((n + 1) * (n + 1)).map((_, i) => Math.cos(i * 0.21) * 0.3);
    world.createCollider(R.ColliderDesc.heightfield(n, n, heights, { x: 64, y: 1, z: 64 }));
    const ground = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, 6, 0));
    for (let i = 0; i < 18; i++) {
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation((i % 6) * 2 - 6, 3 + Math.floor(i / 6) * 2, 2));
      const hull = R.ColliderDesc.convexHull(new Float32Array([0, 0, 0, 0.8, 0, 0, 0, 0.8, 0, 0, 0, 0.8, 0.6, 0.6, 0.6]));
      world.createCollider(i % 3 === 0 ? R.ColliderDesc.cylinder(0.4, 0.3) : i % 3 === 1 && hull !== null ? hull : R.ColliderDesc.cuboid(0.3, 0.5, 0.3), body);
      if (i === 0) world.createImpulseJoint(R.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: 3, z: 0 }), ground, body, true);
    }
    const mover = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 8, 0));
    const capsule = world.createCollider(R.ColliderDesc.capsule(0.5, 0.35), mover);
    const controller = world.createCharacterController(0.02);
    const ray = new R.Ray({ x: 0, y: 20, z: 0 }, { x: 0, y: -1, z: 0 }), ball = new R.Ball(0.25), rotation = { x: 0, y: 0, z: 0, w: 1 };
    try {
      for (let step = 0; step < 240; step++) {
        world.step();
        controller.computeColliderMovement(capsule, { x: 0.04, y: -0.1, z: -0.02 });
        for (let r = 0; r < 8; r++) { ray.origin.x = (r * 5 + step) % 40 - 20; world.castRay(ray, 40, true); world.castRayAndGetNormal(ray, 40, true); }
        world.castShape({ x: 1, y: 10, z: 0 }, rotation, { x: 0, y: -1, z: 0 }, ball, 0, 20, true);
        world.intersectionsWithShape({ x: step % 16 - 8, y: 1, z: 0 }, rotation, ball, () => true);
      }
    } finally { world.removeCharacterController(controller); }
  } finally { world.free(); }
}

test('the warm-up takes Rapier\'s large optimizing compiles; play compiles nothing big', async () => {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const base = malloced();
  const warm = await rise(base, () => { warmRapier(R, () => performance.now()); }, 1_000);
  const play = await rise(base, () => { playWorld(R); }, 500);
  // Without the warm-up, the same play world's second step starts the ~190 MB compile (EM21's journal).
  expect(play / MB, `play rose ${(play / MB).toFixed(1)} MB after a warm-up that rose ${(warm / MB).toFixed(1)} MB`).toBeLessThan(32);
}, 60_000);

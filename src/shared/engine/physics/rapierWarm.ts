/**
 * MEMORY-GATES MG10 (J410): a synthetic physics workload run once, right after Rapier instantiates, so the engine's wasm
 * tier-up of Rapier's hot functions happens then. Measured on Sky Reach (phone tier, Low): V8's tier-up of Rapier landed at
 * the first frame, a ~120-130 MB compile spike on top of the loading peak (`--js-flags=--liftoff-only` removed it). The
 * standalone server's worker is now started early in the boot (`prespawnStandalone`), when the page holds far less, and
 * warms Rapier there. The world it builds touches the server's paths: trimesh and heightfield colliders, dynamic bodies,
 * a character controller, ray and shape casts and steps. It frees everything it made.
 *
 * ENGINE-MEMORY EM21: the spike is one compile. V8 optimizes Rapier 0.21's 366 kB step function (#2643) on the second
 * `world.step()`: about 190 MB of compile memory for 0.3 to 0.45 s, freed when it ends. V8 counts that memory, which sits
 * in its process-wide wasm engine, in every isolate's malloc, so a Chromium dump shows it once per isolate (156 MB
 * "workers" plus part of "main" is one compile). The module is shared (rapierModule.ts), so it compiles once per page.
 * Only a smaller step function avoids it (a Rapier rebuild); JavaScriptCore shows no such spike (EM13).
 * test/rapier-tier-up.test.ts holds every large optimization inside this warm-up.
 */
import type { Rapier } from './rapier';

/** How long the warm-up runs its stepping loop at most (ms, by the clock it is given). */
export const RAPIER_WARM_MS = 120;

/** Run the warm-up world for about `budgetMs`; returns the steps it took. `now` is the clock (ms). */
export function warmRapier(R: Rapier, now: () => number, budgetMs: number = RAPIER_WARM_MS): number {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  try {
    // ground: a 48 x 48 heightfield and a 64 x 64-cell trimesh (8k triangles), as a zone's terrain and level colliders
    const n = 48, heights = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i < heights.length; i++) heights[i] = Math.sin(i * 0.37) * 0.4;
    world.createCollider(R.ColliderDesc.heightfield(n, n, heights, { x: 96, y: 1, z: 96 }));
    const cells = 64, side = cells + 1, vertices = new Float32Array(side * side * 3), indices = new Uint32Array(cells * cells * 6);
    for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
      const at = (z * side + x) * 3;
      vertices[at] = x - cells / 2; vertices[at + 1] = 2 + Math.cos((x + z) * 0.5) * 0.3; vertices[at + 2] = z - cells / 2;
    }
    for (let z = 0, at = 0; z < cells; z++) for (let x = 0; x < cells; x++, at += 6) {
      const a = z * side + x, b = a + 1, c = a + side, d = c + 1;
      indices.set([a, c, b, b, c, d], at);
    }
    world.createCollider(R.ColliderDesc.trimesh(vertices, indices).setTranslation(0, 4, 0));
    for (let i = 0; i < 24; i++) world.createCollider(R.ColliderDesc.cuboid(0.5, 1, 0.5).setTranslation((i % 6) * 5 - 12, 1, Math.floor(i / 6) * 5 - 12));
    for (let i = 0; i < 24; i++) {
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation((i % 6) * 3 - 8, 8 + Math.floor(i / 6) * 2, (i % 4) * 3 - 6));
      world.createCollider(i % 3 === 0 ? R.ColliderDesc.ball(0.4) : i % 3 === 1 ? R.ColliderDesc.capsule(0.4, 0.3) : R.ColliderDesc.cuboid(0.4, 0.4, 0.4), body);
    }
    const mover = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 10, 0));
    const capsule = world.createCollider(R.ColliderDesc.capsule(0.5, 0.35), mover);
    const controller = world.createCharacterController(0.02);
    const ray = new R.Ray({ x: 0, y: 20, z: 0 }, { x: 0, y: -1, z: 0 }), ball = new R.Ball(0.3), rotation = { x: 0, y: 0, z: 0, w: 1 };
    const start = now();
    let steps = 0;
    try {
      do {
        world.step();
        controller.computeColliderMovement(capsule, { x: 0.05, y: -0.1, z: 0.03 });
        for (let r = 0; r < 16; r++) { ray.origin.x = (r * 7 + steps) % 60 - 30; ray.origin.z = (r * 11 + steps) % 60 - 30; world.castRayAndGetNormal(ray, 40, true); }
        world.castShape({ x: 0, y: 12, z: 0 }, rotation, { x: 0, y: -1, z: 0 }, ball, 0, 20, true);
        world.intersectionsWithShape({ x: steps % 20 - 10, y: 2, z: 0 }, rotation, ball, () => true);
        steps++;
      } while (now() - start < budgetMs);
    } finally { world.removeCharacterController(controller); }
    return steps;
  } finally { world.free(); }
}

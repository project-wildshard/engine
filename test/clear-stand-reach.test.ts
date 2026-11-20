import { afterEach, expect, test } from 'vitest';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { GROUP } from '../src/shared/engine/physics/groups';
import { PLAYER_CAPSULE } from '../src/shared/engine/physics/CharacterMotor';
import { CLEAR_STAND, clearStand } from '../src/shared/engine/physics/query';
import type { Collider } from '@dimforge/rapier3d-simd';
import { serverInput } from './fixtures/dedicated/roomBench';

// J295 (served-world-prunes over its 60 s budget, 2026-11-20): `clearStand` casts its nine footprint rays and its capsule only at
// colliders whose bounding sphere reaches the column they fill, not at every world collider in the room (Nalati: 2,687). That skip
// must never change an answer. Here every point of a grid about two cells' spawns, at three heights, gets the same feet (or the
// same refusal) from `clearStand` as from the whole-world scan it replaced: buildings, edges, props and open ground alike.
let live: DedicatedRoom | undefined;
afterEach(() => { live?.dispose(); live = undefined; });

/** The whole-world scan `clearStand` ran before (177540a60, a972c6e5a): every enabled, solid world collider, one by one. */
function wholeWorldStand(room: DedicatedRoom, x: number, z: number, fromY: number, radius: number, height: number): number | undefined {
  const { physics } = room.host, { R } = physics, { lift, drop, skin } = CLEAR_STAND, world: Collider[] = [];
  physics.world.forEachCollider(collider => { if (collider.isEnabled() && !collider.isSensor() && ((collider.collisionGroups() >>> 16) & GROUP.WORLD) !== 0) world.push(collider); });
  const ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  let low = Infinity, high = -Infinity;
  for (let point = -1; point < 8; point++) {
    const angle = point * Math.PI / 4;
    ray.origin = { x: point < 0 ? x : x + Math.cos(angle) * radius, y: fromY + lift, z: point < 0 ? z : z + Math.sin(angle) * radius };
    let near = Infinity;
    for (const collider of world) { const t = collider.castRay(ray, lift + drop, true); if (t >= 0 && t < near) near = t; }
    if (near === Infinity) return undefined;
    const floor = fromY + lift - near;
    low = Math.min(low, floor); high = Math.max(high, floor);
  }
  if (high - low > lift) return undefined;
  const feet = high > fromY ? high + skin : fromY, shape = new R.Capsule(Math.max(0.01, height / 2 - radius), radius);
  return world.some(collider => collider.intersectsShape(shape, { x, y: feet + height / 2 + 0.03, z }, { x: 0, y: 0, z: 0, w: 1 })) ? undefined : feet;
}

test.each([['nalati-grasslands'], ['nine-dragon-stack']] as const)('clearStand in %s answers as the whole-world scan does', { timeout: 120_000 }, async slug => {
  const room = await DedicatedRoom.boot({ slug, build: '', bootId: 'reach', input: await serverInput(slug), now: () => 0, post: () => undefined });
  live = room;
  const { radius, height } = PLAYER_CAPSULE, { spawn } = room;
  const differ: string[] = [];
  let stands = 0, refusals = 0;
  for (let dx = -12; dx <= 12; dx += 1.5) for (let dz = -12; dz <= 12; dz += 1.5) for (const lift of [-1, 0, 1.2]) {
    const x = spawn.x + dx, z = spawn.z + dz, fromY = spawn.y + lift;
    const now = clearStand(room.host.physics, x, z, fromY, { radius, height }), was = wholeWorldStand(room, x, z, fromY, radius, height);
    if (was === undefined) refusals++; else stands++;
    if (now !== was && !(now !== undefined && was !== undefined && Math.abs(now - was) < 1e-6)) differ.push(`${x.toFixed(1)}, ${fromY.toFixed(1)}, ${z.toFixed(1)}: ${String(now)} vs ${String(was)}`);
  }
  expect(differ).toEqual([]);
  // both answers are exercised, so the grid proves the skip on refusals as well as stands
  expect(stands, 'points that stand clear').toBeGreaterThan(20);
  expect(refusals, 'points that are refused').toBeGreaterThan(20);
});

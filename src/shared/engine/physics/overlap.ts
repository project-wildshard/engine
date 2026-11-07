import type { Collider, Cuboid } from '@dimforge/rapier3d-simd';
import type { Physics } from './Physics';
import { queryGroups, type GroupName } from './groups';
import { tagOf } from './surface';

interface Vec3 { x: number; y: number; z: number }
const boxes = new WeakMap<Physics, Map<string, Cuboid>>();
function boxOf(physics: Physics, h: Vec3): Cuboid {
  let m = boxes.get(physics);
  if (!m) { m = new Map(); boxes.set(physics, m); }
  const key = `${h.x},${h.y},${h.z}`;
  let b = m.get(key);
  if (!b) { b = new physics.R.Cuboid(h.x, h.y, h.z); m.set(key, b); }
  return b;
}
/** Read collider owners in a bounded oriented box, without importing the dynamic-body service or render tier. */
export function overlapBox(physics: Physics, at: Vec3, half: Vec3, yaw: number, sees: readonly GroupName[], hit: (owner: unknown, c: Collider) => boolean, as: GroupName = 'SENSOR'): boolean {
  const { R, world } = physics;
  let found = false;
  const box = boxOf(physics, half);
  world.intersectionsWithShape(at, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, box, (c) => {
    if (hit(tagOf(c)?.owner ?? null, c)) { found = true; return false; }
    return true;
  }, R.QueryFilterFlags.EXCLUDE_SENSORS, queryGroups(sees, as));
  return found;
}

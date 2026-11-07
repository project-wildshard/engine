import { castRay } from '../../../shared/engine/physics/query';
import { overlapBox } from '../../../shared/engine/physics/overlap';
import type { Physics } from '../../../shared/engine/physics/Physics';
import type { Navmesh } from '../../../shared/engine/physics/navmesh';
import type { ScriptQuery } from '../../../shared/engine/script/host';

/** Query opcodes: ray, axis-aligned overlap, nearest walkable point, bounded path. */
export const SCRIPT_QUERY: Readonly<{ raycast: 1; overlap: 2; nearest: 3; path: 4; }> = Object.freeze({ raycast: 1, overlap: 2, nearest: 3, path: 4 });
/** Read-only physics and navigation inputs; collider owners map to stable numeric entity handles. */
export interface ScriptPhysics { physics: Physics; navigation: Pick<Navmesh, 'closestWalkable' | 'findPath'>; handle: (owner: unknown) => number | undefined }
/** Deterministic ordering/truncation over the engine's collision/navigation queries, with no direct Rapier import. */
export function scriptPhysicsQueries({ physics, navigation, handle }: ScriptPhysics): ScriptQuery {
  return (kind, input) => {
    if (input.length !== 8 || !input.every(Number.isFinite)) throw new Error('Invalid physics query');
    const [x = 0, y = 0, z = 0, a = 0, b = 0, c = 0, radius = 0] = input;
    if ([x, y, z, a, b, c].some((n) => Math.abs(n) > 250)) throw new Error('Query outside bounds');
    if (kind === SCRIPT_QUERY.raycast) {
      const length = Math.sqrt(a * a + b * b + c * c);
      if (length < 1e-9 || radius < 0 || radius > 500) throw new Error('Invalid ray');
      const hit = castRay(physics, { x, y, z }, { x: a / length, y: b / length, z: c / length }, radius);
      return hit ? [hit.distance, hit.point.x, hit.point.y, hit.point.z, hit.normal.x, hit.normal.y, hit.normal.z, handle(hit.owner) ?? 0] : [];
    }
    if (kind === SCRIPT_QUERY.overlap) {
      if ([a, b, c].some((n) => n <= 0 || n > 50)) throw new Error('Invalid overlap');
      const ids = new Set<number>();
      overlapBox(physics, { x, y, z }, { x: a, y: b, z: c }, 0, ['WORLD', 'CREATURE', 'PLAYER', 'ITEM'], (owner) => { const id = handle(owner); if (id !== undefined) { if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid owner handle'); ids.add(id); } return false; }, 'WORLD');
      return [...ids].sort((left, right) => left - right).slice(0, 96);
    }
    if (radius < 0 || radius > 5) throw new Error('Invalid navigation radius');
    if (kind === SCRIPT_QUERY.nearest) { const nearest = navigation.closestWalkable({ x, y, z }, radius); return nearest ? [nearest.x, nearest.y, nearest.z] : []; }
    if (kind === SCRIPT_QUERY.path) {
      const path = navigation.findPath({ x, y, z }, { x: a, y: b, z: c }, radius, [], 128);
      return path?.slice(0, 32).flatMap((p) => [p.x, p.y, p.z]) ?? [];
    }
    throw new Error('Unknown physics query');
  };
}

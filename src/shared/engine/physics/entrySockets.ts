import type { Scope } from '../app/scope';
import { withOwner } from '../app/ownership';
import { CHUNK_HALF, ENTRY_WIDTH, ENTRY_ASPHALT } from '../core/config';
import type { Physics } from './Physics';
import { groups } from './groups';
import { tagCollider } from './surface';
import { PLATFORM_COLLIDER_OWNER } from './stripColliders';

/** A cell centre in the receiving physics world's frame, never an authored shard collider. */
export interface EntrySocketOrigin { readonly x: number; readonly z: number }
/** One canonical platform-owned asphalt footprint: full width/depth, with its top at road height y=0. */
export interface EntrySocket { readonly x: number; readonly z: number; readonly halfX: number; readonly halfZ: number }
/** Backstops sit 5 mm below separately admitted ground, avoiding duplicate coplanar contacts; they never prove ground exists. */
export type EntrySocketMode = 'floor' | 'backstop';
function socketDepth(mode: unknown): number {
  if (mode === 'floor') return 0;
  if (mode === 'backstop') return 0.005;
  throw new Error('Invalid entry socket mode');
}
/** Pure geometry shared by standalone, grid and regional composition; north is positive z. */
export function entrySockets(origin: EntrySocketOrigin): readonly EntrySocket[] {
  if (![origin.x, origin.z].every(Number.isFinite)) throw new RangeError('Invalid entry socket origin');
  const half = ENTRY_WIDTH / 2, depth = ENTRY_ASPHALT / 2, centre = CHUNK_HALF - depth;
  return [
    { x: origin.x, z: origin.z + centre, halfX: half, halfZ: depth },
    { x: origin.x + centre, z: origin.z, halfX: depth, halfZ: half },
    { x: origin.x, z: origin.z - centre, halfX: half, halfZ: depth },
    { x: origin.x - centre, z: origin.z, halfX: depth, halfZ: half },
  ];
}
/** Install the same four scoped WORLD floors for each cell in any play mode. Returned handles belong to the caller's scope. */
export function installEntrySockets(physics: Physics, scope: Scope, origins: readonly EntrySocketOrigin[], mode: EntrySocketMode = 'floor'): readonly number[] {
  if (scope.disposed) throw new Error('Cannot install entry sockets into a disposed scope');
  const backstopDepth = socketDepth(mode);
  const keys = origins.map((origin) => `${String(origin.x)},${String(origin.z)}`);
  if (new Set(keys).size !== origins.length) throw new Error('Duplicate entry socket cell');
  const sockets = origins.flatMap(entrySockets);
  return withOwner(scope, () => sockets.map((socket) => {
    const collider = physics.world.createCollider(physics.R.ColliderDesc.cuboid(socket.halfX, 0.125, socket.halfZ)
      .setTranslation(socket.x, -0.125 - backstopDepth, socket.z).setCollisionGroups(groups('WORLD')));
    tagCollider(collider, 'stone', PLATFORM_COLLIDER_OWNER);
    return collider.handle;
  }));
}

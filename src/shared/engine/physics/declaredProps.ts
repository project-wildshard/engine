import type { ColliderDesc } from '../../../client/engine/world/registry';
import type { Scope } from '../app/scope';
import { withOwner } from '../app/ownership';
import type { Physics } from './Physics';
import { addPiece } from './pieces';
import { tagCollider, tagOf, untagCollider } from './surface';

/** Authoritative active-state ports for static declared props; scripts call them on the fixed-step host. */
export interface PropColliderPort { active: () => boolean; setActive: (value: boolean) => void; snapshot: () => PropColliderState; restore: (value: PropColliderState) => void }
/** Stable Rapier handles carried by the simulation adapter; activation is saved in the physics snapshot. */
export interface PropColliderState { handles: number[] }
/** Install bounded box/stair descriptors with stable owner IDs. A physics getter reconnects ports after snapshot restore. */
export function installDeclaredPropColliders(rows: readonly { id: string; initialActive: boolean; shapes: readonly ColliderDesc[] }[], physics: Physics | (() => Physics), scope: Scope, restoring?: ReadonlyMap<string, PropColliderState>): ReadonlyMap<string, PropColliderPort> {
  const current = typeof physics === 'function' ? physics : () => physics, ports = new Map<string, PropColliderPort>();
  for (const row of rows) {
    const saved = restoring?.get(row.id);
    if (restoring !== undefined && saved === undefined) throw new Error(`Missing declared collider state ${row.id}`);
    // The cleanup follows the current world after native restore; ambient capture would retain wrappers from the retired world.
    const added = restoring === undefined ? withOwner(null, () => addPiece(current(), { id: row.id, name: row.id, category: 'props', file: 'declared-props', colliders: [...row.shapes] })) : null;
    let handles = saved === undefined ? (added?.colliders ?? []).map((collider) => { const material = tagOf(collider)?.material ?? 'wood'; tagCollider(collider, material, row.id); collider.setEnabled(row.initialActive); return collider.handle; }) : [...saved.handles];
    const colliders = () => handles.map((handle) => { const world = current().world; if (!world.colliders.contains(handle)) throw new Error(`Missing declared collider ${row.id}`); return world.getCollider(handle); });
    ports.set(row.id, { active: () => colliders().every((collider) => collider.isEnabled()), setActive: (value) => { for (const collider of colliders()) collider.setEnabled(value); }, snapshot: () => ({ handles: [...handles] }), restore: (value) => { handles = [...value.handles]; } });
    scope.onDispose(() => { const world = current().world; for (const handle of handles) if (world.colliders.contains(handle)) { const collider = world.getCollider(handle); untagCollider(collider); world.removeCollider(collider, false); } });
  }
  return ports;
}

import type { ShardProps } from '@wildshard/format/props';
import type { ColliderDesc } from '@wildshard/engine/world/registry';

/** Remove absent optional fields before handing admitted shapes to the engine's exact collider descriptor port. */
export function propColliderDescriptors(props: ShardProps): { id: string; initialActive: boolean; shapes: ColliderDesc[] }[] {
  return props.colliders.map((row) => ({ id: row.id, initialActive: row.initialActive, shapes: row.shapes.map((shape): ColliderDesc => {
    const material = shape.surface === undefined ? {} : { surface: shape.surface };
    if (shape.kind === 'treads') return { kind: 'treads', from: { ...shape.from }, to: { ...shape.to }, width: shape.width, count: shape.count, ...material };
    return { kind: 'box', x: shape.x, y: shape.y, z: shape.z, hx: shape.hx, hy: shape.hy, hz: shape.hz, ...(shape.yaw === undefined ? {} : { yaw: shape.yaw }), ...(shape.rot === undefined ? {} : { rot: { ...shape.rot } }), ...material };
  }) }));
}

import { Euler, Quaternion, Vector3 } from 'three';
import type { MoverBox } from '@wildshard/engine/physics/mover';
import type { Shardfile } from '@wildshard/format/shardSchema';

/**
 * SHARD-SOURCE SS-GP5: each steer vehicle's hull, as boxes in its own frame (about its rest, YXZ), by mover id.
 *
 * The format keeps a carry `channel` row box-free, so a vehicle's solids are its panel's collider rows (`props.colliders`
 * whose `panel` is the vehicle's id), written in the cell's frame at its rest. The sdk writes them inactive, so an engine
 * before this leaves them off; here they become the vehicle's kinematic body, which rides it (`MoverRuntime`,
 * `FollowedMovers`). A tread shape is no hull; at most 128 boxes, as a mover holds.
 */
export function vehicleHulls(source: Pick<Shardfile, 'movers'> & Partial<Pick<Shardfile, 'props'>>): ReadonlyMap<string, readonly MoverBox[]> {
  const hulls = new Map<string, readonly MoverBox[]>();
  for (const row of source.movers) {
    if (row.kind !== 'channel' || row.driver?.kind !== 'steer') continue;
    const back = new Quaternion().setFromEuler(new Euler(row.euler.x, row.euler.y, row.euler.z, 'YXZ')).invert();
    const boxes = (source.props?.colliders ?? []).filter(solid => solid.panel === row.id).flatMap(solid => solid.shapes).flatMap((shape): MoverBox[] => {
      if (shape.kind !== 'box') return [];
      const at = new Vector3(shape.x - row.at.x, shape.y - row.at.y, shape.z - row.at.z).applyQuaternion(back);
      const turn = shape.rot === undefined ? new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), shape.yaw ?? 0) : new Quaternion(shape.rot.x, shape.rot.y, shape.rot.z, shape.rot.w);
      const rot = back.clone().multiply(turn).normalize();
      return [{ x: at.x, y: at.y, z: at.z, hx: shape.hx, hy: shape.hy, hz: shape.hz, rot: { x: rot.x, y: rot.y, z: rot.z, w: rot.w } }];
    }).slice(0, 128);
    if (boxes.length > 0) hulls.set(row.id, boxes);
  }
  return hulls;
}

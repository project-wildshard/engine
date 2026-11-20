import type { Collider, Cuboid } from '@dimforge/rapier3d-simd';
import type { MoverBox } from '@wildshard/format/moverPose';
import type { Physics } from '../physics/Physics';
import type { SimCommand } from '../../../server/engine/sim';
import { steerStick } from './moverMotion';
import type { VehicleCommand } from './vehicle';

/**
 * MIRROR-SALT-ZONE MSZ16: what the server's `VehicleRuntime` and its driver's page both need to step a vehicle alike: the
 * hull's reach, its shape cast (MSZ13) and the driver's command read off a tick's command (MSZ12). The server reads its
 * hits against everything (walkers, creatures, other vehicles); a page against what it has, and its rows correct the rest.
 */

/** The hull's cast box rides this far over the vehicle's base (m), clear of the ground's bumps, and is this tall: a kerb or a
 *  ramp is the floor probe's, a wall, a vehicle or a walker the cast's. */
export const HULL_LIFT = 0.35, HULL_HEIGHT = 1.2;
/** A ground normal shorter than this is a floor or a ramp, not a wall: the cast leaves it to the floor probe. */
const WALL_NORMAL = 0.5;

/** What a vehicle's hull meets besides a static solid: another vehicle gives a little back; a walker or a creature (kg) is
 *  pushed aside, so gives nothing back. */
export const VEHICLE_RESTITUTION = { solid: 0.35, vehicle: 0.3, walker: 0 } as const;

/** How far a hull reaches forward (its frame's -z), back and to the side: where its wheels read the ground. */
export interface VehicleReach { readonly bow: number; readonly stern: number; readonly side: number }
export function vehicleReach(boxes: readonly MoverBox[]): VehicleReach {
  const most = (pick: (box: MoverBox) => number): number => boxes.reduce((far, box) => Math.max(far, pick(box)), 0.5);
  return { bow: most(box => -box.z + box.hz), stern: most(box => box.z + box.hz), side: most(box => Math.abs(box.x) + box.hx) };
}

/** What a hull's cast met: how far along the move (0 to 1), the wall's ground normal (out of it, toward the vehicle) and the
 *  collider; the caller says what it was. */
export interface HullContact { readonly at: number; readonly normal: { readonly x: number; readonly z: number }; readonly collider: Collider; readonly touching: boolean }

/** One cast shape per reach, kept by whoever casts. */
export type HullShapes = Map<string, Cuboid>;

/** What a hull of `reach` meets moving by `move` from `from` at heading `yaw`, among `groups` (as `queryGroups` makes), for the
 *  colliders `keep` lets through; none, or a floor-like surface (the floor probe's), is null. */
export function castVehicleHull(physics: Physics, shapes: HullShapes, reach: VehicleReach, from: { readonly x: number; readonly y: number; readonly z: number },
  move: { readonly x: number; readonly z: number }, yaw: number, groups: number, keep: (collider: Collider) => boolean): HullContact | null {
  const length = Math.hypot(move.x, move.z); if (length < 1e-6) return null;
  const back = (reach.stern - reach.bow) / 2, sin = Math.sin(yaw), cos = Math.cos(yaw);
  const key = `${String(reach.bow)}:${String(reach.stern)}:${String(reach.side)}`;
  let shape = shapes.get(key);
  if (shape === undefined) { shape = new physics.R.Cuboid(reach.side, HULL_HEIGHT / 2, (reach.bow + reach.stern) / 2); shapes.set(key, shape); }
  const centre = { x: from.x + back * sin, y: from.y + HULL_LIFT + HULL_HEIGHT / 2, z: from.z + back * cos };
  const hit = physics.world.castShape(centre, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, { x: move.x / length, y: 0, z: move.z / length }, shape, 0, length, false,
    physics.R.QueryFilterFlags.EXCLUDE_SENSORS, groups, undefined, undefined, keep);
  if (hit === null) return null;
  // the surface's normal, out of what was hit: against the move (a cast's two normals face each other)
  const ground = Math.hypot(hit.normal1.x, hit.normal1.z); if (ground < WALL_NORMAL) return null;
  const facing = hit.normal1.x * move.x + hit.normal1.z * move.z > 0 ? -1 : 1;
  return { at: hit.time_of_impact / length, normal: { x: facing * hit.normal1.x / ground, z: facing * hit.normal1.z / ground }, collider: hit.collider, touching: hit.time_of_impact <= 1e-4 };
}

/**
 * MSZ12: a driver's controls off one tick's command, whatever way the driver looks (the chase view, a look round): the raw
 * stick's forward is the throttle (back brakes, then reverses) and its side the turn; sprint or boost boosts; BRAKE and the
 * handbrake ride as held buttons. A command with no raw stick (a headless tape's world move) is read along the heading `yaw`.
 * The server reads its tick's command (`driverStick`), the driver's page each command it sends (MSZ16).
 */
export function vehicleCommandOf(command: SimCommand, yaw: number): VehicleCommand {
  const steer = command.commandVersion === 1 ? command.steer : undefined, clamp = (value: number): number => Math.max(-1, Math.min(1, value));
  const boost = command.boost === true || command.sprint === true;
  const stick: VehicleCommand = steer === undefined ? steerStick({ x: command.moveX, z: command.moveZ }, yaw, boost)
    : { throttle: clamp(steer.keyY + steer.stickY), turn: clamp(steer.keyX + steer.stickX), boost };
  return { ...stick, ...(command.brake === true ? { brake: true } : {}), ...(command.handbrake === true ? { handbrake: true } : {}) };
}

import type { Physics } from '../../physics/Physics';
import { floorBelow, lineOfSight } from '../../physics/query';

interface Point { x: number; y: number; z: number }

/** The item's fixed hover height; its interaction point sits another half metre above this. */
export const ITEM_PICKUP_HOVER = 0.78;

/** Settle an untossed item on the first WORLD floor below its centre. An inside-surface ray or absent floor keeps
 * the supplied point. The page and renderer-free rewards share this exact query and comparison. */
export function itemPickupFloor(physics: Physics | null, point: Point): Point {
  const from = point.y + 1.2, y = physics ? floorBelow(physics, point.x, point.z, from, 1.2 + 2) : undefined;
  return { x: point.x, y: y !== undefined && y < from - 0.01 ? y : point.y, z: point.z };
}

/** The page's walk-in pickup law: strict foot radius and height, then chest-to-pickup native world visibility.
 * A null world preserves the existing pre-physics behavior; an admitted host supplies its actual physics. */
export function walkInPickup(physics: Physics | null, feet: Point, pickup: Point): boolean {
  const dx = feet.x - pickup.x, dz = feet.z - pickup.z;
  return dx * dx + dz * dz < 1.1 * 1.1 && Math.abs(feet.y - pickup.y) < 2.2 &&
    (physics === null || lineOfSight(physics, { x: feet.x, y: feet.y + 1, z: feet.z }, { x: pickup.x, y: pickup.y + 0.5, z: pickup.z }, 0.3));
}

import { nativeRangedAim, nativeRangedHit } from '@wildshard/engine/game/plugin/nativeItems';
import type { Vector3 } from 'three';
import type { SimHost } from '@wildshard/engine/sim';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';

/** The page Player's eye over its feet (player/Player.ts EYE): every aim line starts there. */
export const EYE = 1.68;
/** A body's hit along a ray: the body, head or not, the distance along the ray, the point (the result is reused). */
export interface BodyHit { body: AnimalSim | null; head: boolean; distance: number; point: Vector3 }

/** Existing proof utility delegates to the native item's one published-volume reader. */
export function bodyHit(bodies: readonly AnimalSim[], origin: Vector3, direction: Vector3, max: number): BodyHit | null {
  return nativeRangedHit(bodies, origin, direction, max);
}
/** The `script` command that says where on the body the tick's shots are aimed: its value is the share along the target's
 *  body capsule, from its rear end (0) to its front end (1; a King's ribcage is at 0.75); no command, its middle. */
export const AIM_COMMAND = 'pine.aim';
/** Explicit point aim at a body's declared ribcage (the camera can aim at it on the page); never a damage override. */
export const AIM_RIBS = 2;
/** The aim's share along the body when the tick names none: the capsule's middle. */
export const AIM_MIDDLE = 0.5;
/** A tick's aim share, clamped to the body (a non-finite value is the middle). */
export const aimShare = (value: number): number => (value === AIM_RIBS ? AIM_RIBS : Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : AIM_MIDDLE);

/** The player's eye (`eye`) and the unit aim line from it to the point `along` the target's body capsule (`fwd`; its middle by
 *  default): the tape aims at a point of a body where the page aims along the camera. */
export function aimAt(host: SimHost, target: AnimalSim, eye: Vector3, fwd: Vector3, along = AIM_MIDDLE): void {
  nativeRangedAim(leadPlayer(host), target, eye, fwd, along);
}

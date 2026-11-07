import { MathUtils } from 'three';
import { DRAW_TIME } from './bowDraw';
import { drawnSpreadDegrees } from './shotSpread';
import type { BowProfile } from '../../../client/engine/combat/view/bowProfile';

/** A held bow's gameplay law as numbers only: what blocks the draw and the AIM toggle, the saddle's draw rate, spread,
 *  rear (Parthian) shot and carrier velocity, the loose's spread and the arrow's launch speed and muzzle. No view, rig
 *  or input: the page's Bow (combat/view/Bow.ts) and the Node simulation (CI12's Nalati tape) apply the same numbers. */

/** The profile numbers the law reads. */
export type BowLawProfile = Pick<BowProfile, 'mounted' | 'draw' | 'loose' | 'aimSpread' | 'speedBase' | 'speedDraw'>;

/** Running on foot lowers the bow (a gallop does not: horse archery); a disabled bow, a cancelled draw, an empty quiver,
 *  running or swimming blocks the draw. */
export function bowBlocked(s: { readonly enabled: boolean; readonly cancel: boolean; readonly bolts: number; readonly sprinting: boolean;
  readonly mounted: boolean; readonly swimming: boolean }): { readonly running: boolean; readonly blocked: boolean } {
  const running = s.sprinting && !s.mounted;
  return { running, blocked: !s.enabled || s.cancel || s.bolts <= 0 || running || s.swimming };
}

/** AIM (RMB / the AIM disc) holds while asked for, enabled, not running and not swimming. */
export function bowAimOn(s: { readonly asked: boolean; readonly enabled: boolean; readonly running: boolean; readonly swimming: boolean }): boolean {
  return s.asked && s.enabled && !s.running && !s.swimming;
}

/** The saddle's share: the draw-rate multiplier, the added spread (degrees), whether the arc shows, whether the view is a
 *  rear shot (past the profile's rear angle off the horse's heading), whether mounted, and the horse's velocity the arrow
 *  carries. */
export interface BowMountState {
  readonly draw: number; readonly spread: number; readonly arc: boolean; readonly parthian: boolean; readonly mounted: boolean;
  readonly carrier: { readonly x: number; readonly y: number; readonly z: number };
}
/** On foot (`mount` null) the saddle adds nothing; mounted, from the profile's gait and rear rows. Null: a mounted rider
 *  whose profile has no mounted rows (the bow keeps what it had). */
export function bowMount(profile: BowLawProfile, playerYaw: number, mount: { readonly speed: number; readonly yaw: number } | null): BowMountState | null {
  if (mount === null) return { draw: 1, spread: 0, arc: true, parthian: false, mounted: false, carrier: { x: 0, y: 0, z: 0 } };
  const mounted = profile.mounted;
  if (mounted === undefined) return null;
  const v = mount.speed;
  const gait = mounted.gaits.find((row) => v < row.below)?.spread ?? 0;
  let off = playerYaw - mount.yaw; off = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
  const parthian = off > MathUtils.degToRad(mounted.rearAngle);
  return { draw: (profile.draw?.drawTime ?? DRAW_TIME) / (mounted.drawTime + (parthian ? mounted.rearDraw : 0)), spread: gait + (parthian ? mounted.rearSpread : 0),
    arc: mounted.arc, parthian, mounted: true, carrier: { x: -Math.sin(mount.yaw) * v, y: 0, z: -Math.cos(mount.yaw) * v } };
}

/** The loose's cone width (degrees): the hip width narrowed by AIM, the motion share, the extra (Golden Bow) and the
 *  saddle's spread. */
export function bowLooseSpreadDegrees(profile: BowLawProfile, aimBlend: number, speedFactor: number, extraSpreadDeg: number, mountSpread: number): number {
  return drawnSpreadDegrees(profile.loose?.degrees ?? 0.3, profile.aimSpread, aimBlend, profile.loose?.motion ?? 0.6, speedFactor, extraSpreadDeg, mountSpread);
}
/** The arrow's launch speed at draw `p` (the carrier's velocity adds on top) and how far ahead of the eye it starts. */
export function bowLaunchSpeed(profile: BowLawProfile, p: number): number { return profile.speedBase + profile.speedDraw * p; }
export function bowMuzzle(profile: BowLawProfile): number { return profile.loose?.muzzle ?? 0.55; }

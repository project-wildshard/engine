import { Euler, MathUtils, Vector3, type PerspectiveCamera } from 'three';
import type { PlayerEye } from '@wildshard/engine/player/Player';
import type { MoverPose } from '@wildshard/format/moverPose';
import { vehiclePoint } from './followedMovers';

/**
 * MIRROR-SALT-ZONE MSZ11: the view from a vehicle's seat (Jake's call 7, B). First person, as the game is: the eye sits at the
 * seat's height on the vehicle as the page draws it, so the bonnet and the wheel or tiller are in view, and the view widens
 * past top speed. One press away (V, or a tap on the gauge) is the chase view: behind and above the vehicle, pulled in when a
 * wall stands between. The look (yaw, pitch) is the player's in both, so mouse look and the LOOK pad look round, and the seat's
 * swing-back (`STEER_RECENTRE`) turns both.
 */

/** m from a seat's base (`VehicleSeat.at`, where the hips or soles rest) up to the eye: seated upright (hips 0.11 m over the
 *  base as other pages pose them, eye 0.78 m over the hips as standing), or standing on soft knees (1.68 m on foot). */
export const SEAT_EYE = { sit: 0.88, stand: 1.6 } as const;
/** The field of view's widening (degrees): none below `from` of the kind's top speed, `top` at its top speed, `boost` at its
 *  boosted top. Each stretch eases in and out (smoothstep), so it never kinks. */
export const SEAT_WIDEN = { from: 0.6, top: 6, boost: 14 } as const;
/** The look's pitch a seat sets on boarding and swings back to (rad, down): the road ahead fills the middle of the view and the
 *  bonnet the bottom, on a desktop (horizon about 40% down) and a portrait phone (about 43%) alike. */
export const SEAT_PITCH = -0.15;
/** rad more the seat's eye looks down on a portrait phone (aspect 0.46 and under; none at 1 and over): its taller view
 *  would otherwise be nearly half sky. Nothing aims from a seat (the held item is stowed), so only the camera tips. */
export const PORTRAIT_DROP = 0.2;
/** The chase view: `back` and `up` m off the pivot (the vehicle's centre at the seat eye's height), turned by the look (its
 *  pitch taken from `SEAT_PITCH`); `tilt` rad down, and up to `pulled` rad more as a wall pulls it in, so the vehicle stays
 *  in frame; pulled in to `margin` m short of a wall but never nearer than `near`; eased back out at `ease` per second. */
export const CHASE = { back: 6, up: 1.4, tilt: 0.13, pulled: 0.45, margin: 0.3, near: 1.2, ease: 4, pitch: [-0.9, 0.45] } as const;

const smooth = (t: number): number => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/** The eye's height over a seat's base. */
export function seatEyeHeight(pose: 'sit' | 'stand'): number { return SEAT_EYE[pose]; }

/** Degrees to widen the view by at `speed` m/s, for a kind of top `speed` m/s that boosts to `speed × boost`. */
export function seatWiden(speed: number, handling: { readonly speed: number; readonly boost: number }): number {
  if (handling.speed <= 0) return 0;
  const share = speed / handling.speed;
  const toTop = SEAT_WIDEN.top * smooth((share - SEAT_WIDEN.from) / (1 - SEAT_WIDEN.from));
  return handling.boost <= 1 ? toTop : toTop + (SEAT_WIDEN.boost - SEAT_WIDEN.top) * smooth((share - 1) / (handling.boost - 1));
}

/** The camera zoom that widens a `fov`° view by `widen`°: the held weapon owns `fov`, so the seat widens through zoom alone. */
export function widenZoom(fov: number, widen: number): number {
  const half = MathUtils.degToRad(fov) / 2, wide = Math.min(MathUtils.degToRad(170) / 2, half + MathUtils.degToRad(widen) / 2);
  return Math.tan(half) / Math.tan(wide);
}

/** What a seat's eye reads each frame, live at the pose (the vehicle's drawn pose moves within the frame). */
export interface SeatNow {
  /** The vehicle's pose as the page draws it. */
  readonly pose: MoverPose;
  /** The seat's base in the vehicle's frame, and how it is sat. */
  readonly at: readonly [number, number, number];
  readonly sit: 'sit' | 'stand';
  /** Its speed (m/s, as the gauge eases it) and the kind's top speed and boost. */
  readonly speed: number;
  readonly handling: { readonly speed: number; readonly boost: number };
}
/** What a seat's eye is lent. */
export interface SeatEyePort {
  /** The seat now, or null when there is none (the eye then leaves the camera be). */
  readonly seat: () => SeatNow | null;
  /** The player's look. */
  readonly look: { readonly yaw: number; readonly pitch?: number };
  /** Whether the chase view is on. */
  readonly chase: () => boolean;
  /** m clear from `from` toward `to` before a wall (the vehicle's own hull aside); the whole way when nothing is between. */
  readonly clear?: (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) => number;
}

/** A vehicle seat's eye on the page's player (`Player.eye`). */
export class SeatEye implements PlayerEye {
  private readonly port: SeatEyePort;
  private camera: PerspectiveCamera | null = null;
  /** The chase view's pulled-in distance along its arm (m), eased back out. */
  private reach: number = Math.hypot(CHASE.back, CHASE.up);
  private readonly arm = new Vector3();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  /** The last widening (degrees), for a probe. */
  widen = 0;
  constructor(port: SeatEyePort) { this.port = port; }

  pose(camera: PerspectiveCamera, dt: number): void {
    const seat = this.port.seat(); if (seat === null) return;
    this.camera = camera;
    const eye = seat.at[1] + seatEyeHeight(seat.sit), yaw = this.port.look.yaw, pitch = this.port.look.pitch ?? 0;
    camera.rotation.set(0, 0, 0, 'YXZ');
    if (!this.port.chase()) {
      const [x, y, z] = vehiclePoint(seat.pose, [seat.at[0], eye, seat.at[2]]);
      const tall = camera.aspect >= 1 ? 0 : Math.min(1, (1 - camera.aspect) / 0.54);
      camera.position.set(x, y, z); camera.rotation.y = yaw; camera.rotation.x = pitch - PORTRAIT_DROP * tall;
      this.reach = Math.hypot(CHASE.back, CHASE.up); // the next chase starts out at full length
    } else {
      const [px, py, pz] = vehiclePoint(seat.pose, [0, eye, 0]);
      const full = Math.hypot(CHASE.back, CHASE.up), pulled = 1 - Math.min(1, this.reach / full);
      const tilt = Math.max(CHASE.pitch[0], Math.min(CHASE.pitch[1], pitch - SEAT_PITCH)) - CHASE.tilt - CHASE.pulled * pulled;
      this.euler.set(tilt, yaw, 0, 'YXZ');
      const arm = this.arm.set(0, CHASE.up, CHASE.back).applyEuler(this.euler);
      arm.divideScalar(full);
      const pivot = { x: px, y: py, z: pz }, want = { x: px + arm.x * full, y: py + arm.y * full, z: pz + arm.z * full };
      const free = this.port.clear?.(pivot, want) ?? full;
      const target = free >= full - 1e-3 ? full : Math.max(CHASE.near, free - CHASE.margin);
      // a wall pulls the view in at once; open ground lets it ease back out
      this.reach = target < this.reach ? target : this.reach + (target - this.reach) * (1 - Math.exp(-dt * CHASE.ease));
      camera.position.set(px + arm.x * this.reach, py + arm.y * this.reach, pz + arm.z * this.reach);
      camera.rotation.y = yaw; camera.rotation.x = tilt;
    }
    this.widen = seatWiden(seat.speed, seat.handling);
    const zoom = widenZoom(camera.fov, this.widen);
    if (Math.abs(camera.zoom - zoom) > 1e-4) { camera.zoom = zoom; camera.updateProjectionMatrix(); }
  }
  /** The seat is left: the view's own field of view again. */
  release(): void {
    const camera = this.camera; this.camera = null; this.widen = 0;
    if (camera !== null && camera.zoom !== 1) { camera.zoom = 1; camera.updateProjectionMatrix(); }
  }
}

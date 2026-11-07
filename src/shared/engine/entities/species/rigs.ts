import { MathUtils, Vector3, type Bone, type Vector3Like } from 'three';
import type { FurStyle } from './registry';
import { smoothstep } from '../../core/noise';

/**
 * Helpers shared by the CUSTOM rigs (crab / monkey / sailor — `SpeciesDef.rig: 'custom'`): pose maths that every
 * non-quadruped needs and a placeholder FurStyle (these species only ever render faceted, but the registry contract
 * wants one).
 */

export const smooth01 = (t: number): number => smoothstep(0, 1, t);   // the one smoothstep (E357 X5)
export const clamp: typeof MathUtils.clamp = MathUtils.clamp;
/** a unit bump: 0 → 1 → 0 over [a, b] */
export const bump = (x: number, a: number, b: number): number => (x <= a || x >= b ? 0 : Math.sin(((x - a) / (b - a)) * Math.PI));
/** 0 before a, 1 after b, smooth between */
export const step = (x: number, a: number, b: number): number => smooth01((x - a) / (b - a));

const _v = new Vector3();
const _look = { yaw: 0, pitch: 0 };

/** What `lookAngles` reads: a rig's animate context, or a renderer-free pose input with plain points. */
export interface LookInput { readonly lookWeight: number; readonly lookTarget: Vector3Like; readonly position: Vector3Like; readonly yaw: number; readonly scale: number }

/** the look target in the animal's frame: yaw (+ = to the animal's left) and pitch (+ = up), scaled by lookWeight, clamped
 *  (pitch to [minPitch, maxPitch]: a tall rig looks down further than up) */
export function lookAngles(c: LookInput, eyeY: number, maxYaw = 1.2, maxPitch = 0.6, minPitch: number = -maxPitch): { yaw: number; pitch: number } {
  if (c.lookWeight < 0.001) { _look.yaw = 0; _look.pitch = 0; return _look; }
  _v.subVectors(c.lookTarget, c.position);
  let ly = Math.atan2(_v.x, _v.z) - c.yaw;
  ly = Math.atan2(Math.sin(ly), Math.cos(ly));
  const dist = Math.hypot(_v.x, _v.z);
  _look.yaw = clamp(ly, -maxYaw, maxYaw) * c.lookWeight;
  _look.pitch = clamp(Math.atan2(_v.y + 1.4 - eyeY * c.scale, dist), minPitch, maxPitch) * c.lookWeight;   // the player's eyes are ~1.4 m over their feet
  return _look;
}

/** the faceted species never draw fur; the registry contract wants a FurStyle regardless */
export const NO_FUR: FurStyle = {
  texSeed: 1, tex: { contrast: 0.5, grizzle: 0, normalStrength: 1, bristle: 0, strandLen: 8, root: 0.2 },
  roughness: 0.9, sheen: 0.02, sheenColor: [0.2, 0.2, 0.2], envMapIntensity: 0.6, rim: [0.5, 0.5, 0.5], shellLen: 0.0, shag: 0,
};

/**
 * Squash & stretch on a hit (remaster M3, a hook for the feel-agent's hit reactions): a volume-preserving wobble of the
 * root bone driven by the rig's `flinch` (1 at the blow, decaying to 0) — squashed flat at the blow, a stretch as it
 * springs back, settling. Every custom rig calls it last in `animate`: `squashBody(b.body, c.flinch)`.
 */
export function squashBody(b: Pick<Bone, 'scale'>, flinch: number, amt = 0.2): void {
  const k = clamp(flinch, 0, 1);
  const w = k * k * Math.cos((1 - k) * 10) * amt;
  const sy = 1 - w, sxz = 1 / Math.sqrt(Math.max(0.5, sy));
  b.scale.set(sxz, sy, sxz);
}

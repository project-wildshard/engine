import { STARTER_MELEE_PROFILE } from './starterCombat';
import type { Key, Move } from '@wildshard/engine/combat/view/melee';
import type { SweptBladeRig } from '@wildshard/engine/combat/sweptBlade';
import * as THREE from 'three';

/**
 * SwordMoves — the keyframes of every sword swing (Sword.ts evaluates them): the three-hit light combo and the heavy.
 * Camera space at scale 1 (landscape): +X right, +Y up, -Z forward; a key is where the hands are, which way the blade
 * points and the roll about it (0 = the flat toward the eye). Each move has a wind-up key (cocked), a mid-slash key
 * and a follow-through key; the swing starts from wherever the sword IS (the rest pose, or the previous swing's
 * follow-through when the combo chains) and recovers to REST.
 *
 *   1 · slash      right → left, horizontal — the wooden-sword mockup (art/driftwood-isle/round-2-first-person/driftwood-fp-sword-wooden.png)
 *   2 · backhand   left → right, rising a little — cocked from where the slash left the blade
 *   3 · finisher   raised high on the right, an overhead diagonal down to the lower left (the iron mockup's arc)
 *   H · heavy      charged overhead (CHARGE key held with the blade raised), released into a wide slow overhead chop
 *
 * Times are seconds from the swing's start: `windup` (the active window opens), `slashEnd` (it closes; a queued combo
 * swing chains here), `total` (back at rest). The hit test is the blade itself, swept through the active window (Sword.ts).
 */


const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _q2 = new THREE.Quaternion();
/** quaternion that takes +Y to `dir` then rolls about it */
export function poseQuat(out: THREE.Quaternion, dir: THREE.Vector3, roll: number): THREE.Quaternion {
  out.setFromUnitVectors(Y_AXIS, dir);
  return out.multiply(_q2.setFromAxisAngle(Y_AXIS, roll));
}
/** Build an authored sword key from its time, hand position, blade direction and roll. */
export const key = (t: number, px: number, py: number, pz: number, dx: number, dy: number, dz: number, roll: number): Key =>
  ({ t, pos: new THREE.Vector3(px, py, pz), q: poseQuat(new THREE.Quaternion(), new THREE.Vector3(dx, dy, dz).normalize(), roll) });

/** rest = the spawn mockup, held lower (E129: it covered Wendell and the middle-right of the view): hands at the lower-right
 *  edge, the blade tipped forward so its tip rests low-right of the crosshair, clear of an NPC you walk up to (was 0.27, -0.33 · dir -0.34, 0.76, -0.55) */
export const REST: Key = key(0, 0.31, -0.35, -0.52, -0.20, 0.58, -0.79, 0.35);
/** RMB / touch AIM held: the blade raised high over the right shoulder, tip up and a little back — the heavy's charge */
export const CHARGE: Key = key(0, 0.27, -0.09, -0.50, 0.24, 0.92, 0.30, 0.1);
/** The original lowered hand pose while sprinting. */
export const SPRINT: Key = key(0, 0.34, -0.46, -0.58, -0.2, 0.55, -0.81, 0.6);

const white = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

/** The original first light-combo move and trail parameters. */
export const SLASH: Move = {
  name: 'slash',
  keys: [
    key(0.07, 0.42, -0.25, -0.50, 0.62, 0.62, -0.48, 0.55),     // cocked: blade up-right, tip toward the frame's right edge
    key(0.13, 0.22, -0.33, -0.48, -0.70, 0.48, -0.53, 0.3),     // mid-slash: sweeping across, tip upper-left of centre (the mockup frame)
    key(0.235, -0.02, -0.35, -0.46, -0.88, 0.22, -0.42, 0.15),  // follow-through: blade out to the left, still rising a little
  ],
  ...STARTER_MELEE_PROFILE.moves.combo[0], hitStop: 0.06, kick: { pitch: -0.6, roll: 1.6 },
  trail: { from: 0.62, color: white(1, 1, 1), alpha: 0.6, inner: 0, life: 0.13 },
};

/** The original second light-combo move and trail parameters. */
export const BACKHAND: Move = {
  name: 'backhand',
  keys: [
    key(0.06, -0.12, -0.28, -0.48, -0.82, 0.46, -0.34, -0.35),   // cocked further left, edge turned to lead the other way
    key(0.125, 0.10, -0.30, -0.50, 0.02, 0.62, -0.78, -0.2),     // mid: tip straight ahead and up, crossing the centre
    key(0.22, 0.40, -0.26, -0.50, 0.86, 0.36, -0.36, -0.1),      // follow-through: blade out to the right, tip past the frame edge
  ],
  ...STARTER_MELEE_PROFILE.moves.combo[1], hitStop: 0.06, kick: { pitch: -0.6, roll: -1.6 },
  trail: { from: 0.58, color: white(0.9, 0.97, 1), alpha: 0.6, inner: 0.05, life: 0.13 },
};

/** The original final light-combo move and trail parameters. */
export const FINISHER: Move = {
  name: 'finisher',
  keys: [
    key(0.10, 0.30, -0.08, -0.50, 0.32, 0.92, -0.22, 0.2),      // raised high on the right, tip up
    key(0.19, 0.12, -0.20, -0.48, -0.36, 0.52, -0.77, 0.15),    // coming down through the centre, tip forward-up-left
    key(0.28, -0.14, -0.44, -0.44, -0.72, -0.28, -0.63, 0.05),  // low left, tip below the frame centre
  ],
  ...STARTER_MELEE_PROFILE.moves.combo[2], hitStop: 0.09, kick: { pitch: -1.8, roll: 1.1 },
  trail: { from: 0.5, color: white(1, 0.97, 0.88), alpha: 0.7, inner: 0.1, life: 0.15 },
};

/** The original charged-heavy move and trail parameters. */
export const HEAVY: Move = {
  name: 'heavy',
  keys: [
    key(0.06, 0.29, -0.03, -0.50, 0.30, 0.89, 0.36, 0.1),       // an extra pull back over the shoulder off the charge pose
    key(0.17, 0.08, -0.18, -0.52, -0.16, 0.58, -0.80, 0.05),    // the chop: blade forward-up through the centre, edge on
    key(0.30, -0.12, -0.50, -0.44, -0.56, -0.46, -0.69, 0.0),   // buried low left, tip below the frame
  ],
  ...STARTER_MELEE_PROFILE.moves.heavy, hitStop: 0.14, kick: { pitch: -2.6, roll: 0.8, fov: -2 },
  trail: { from: 0.34, color: white(1, 0.98, 0.94), alpha: 1.0, inner: 0.35, life: 0.22 },
};

/** The original light-combo order, preserving move object identities. */
export const COMBO: Move[] = [SLASH, BACKHAND, FINISHER];

/** Seconds the blade takes to rise into the charge pose. */
export const CHARGE_BLEND = 0.16;
/** The starter sword's tip up its blade (m from the grip): `buildSword`'s guard, step and blade length. */
export const STARTER_SWORD_TIP: number = 0.085 + 0.014 + 0.52;
/** Everything a blade sweep needs of the starter sword, renderer-free: its swings and where its tip sits. The page's `Sword`
 * sweeps these; so does the native owner (P1-E3.5), since the shard's rows carry a move's numbers and never its keys. */
export const STARTER_BLADE: SweptBladeRig = { rest: REST, charge: CHARGE, sprint: SPRINT, combo: COMBO, heavy: HEAVY, chargeBlend: CHARGE_BLEND, tipX: 0, tipY: STARTER_SWORD_TIP };

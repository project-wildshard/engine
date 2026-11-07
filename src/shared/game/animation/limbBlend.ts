import { MathUtils } from 'three';
import { clamp, lookAngles, step } from '@wildshard/engine/entities/species/rigs';
import { type LimbBlend, readBakedClips } from '@wildshard/format/limbRig';
import { addLimbPose, newLimbPose, playBakedClip, scaleLimbPose, zeroLimbPose, type LimbPose, type LimbPoseRest } from './limbRig';

/** Borrowed scalar frame from the existing animal animation clock. No renderer, random draw or second timer owner. */
export interface LimbPoseInput {
  dt: number; t: number; scale: number; speed: number; deathT: number;
  flinch: number; brace: number; attack: number; lookWeight: number; yaw: number;
  lookTarget: Readonly<{ x: number; y: number; z: number }>;
  position: Readonly<{ x: number; y: number; z: number }>;
  mem: Record<string, number>;
}
/** One admitted clip bank and reusable scratch, owned by its species/pose service. */
export class LimbAnimator {
  private readonly clip = newLimbPose();
  private readonly read;
  private readonly names: ReadonlySet<string>;
  constructor(readonly row: LimbBlend, clips: unknown, readonly head: string) {
    this.read = readBakedClips(clips);
    this.names = new Set([...Object.values(row.clips), row.defaultAttack, ...row.attacks.map(a => a.clip)]);
    for (const name of this.names) this.read(name);
  }
  /** Hold any baked clip for proofs/debug; seconds for idle, normalized progress/phase for the others. */
  sample(p: LimbPose, name: string, x: number, t = 0): LimbPose {
    return playBakedClip(this.read(name), zeroLimbPose(p), x, t);
  }
  /** Locomotion -> held action -> recoil -> attention, retaining arithmetic and Float32 foot accumulation order. */
  advance(c: LimbPoseInput, r: LimbPoseRest, into: LimbPose, debug?: { gait: string; phase: number }): LimbPose {
    const row = this.row, keys = row.memory, m = c.mem, P = zeroLimbPose(into), clips = row.clips;
    if (debug !== undefined && this.names.has(debug.gait)) {
      addLimbPose(P, this.sample(this.clip, debug.gait, debug.gait === clips.idle ? c.t : debug.phase, c.t), 1);
      return P;
    }
    if (c.deathT >= 0) { addLimbPose(P, this.sample(this.clip, clips.death, c.deathT, c.t), 1); return P; }
    const v = Math.abs(c.speed) / Math.max(1e-3, c.scale);
    const runK = step(v, ...row.run), walkK = step(v, ...row.walk) * (1 - runK);
    const ww0 = m[keys.walk] ?? 0, rw0 = m[keys.run] ?? 0;
    const ww = ww0 + (walkK - ww0) * Math.min(1, c.dt * row.response[0]);
    const rw = rw0 + (runK - rw0) * Math.min(1, c.dt * row.response[1]), iw = Math.max(0, 1 - ww - rw);
    m[keys.walk] = ww; m[keys.run] = rw;
    const stride = MathUtils.lerp(r.walkStride, r.chargeStride, clamp(rw / Math.max(1e-3, ww + rw), 0, 1));
    const ph = ((m[keys.phase] ?? 0) + (v / stride) * c.dt) % 1;
    m[keys.phase] = ph;
    if (iw > 0) addLimbPose(P, this.sample(this.clip, clips.idle, c.t), iw);
    if (ww > 0) addLimbPose(P, this.sample(this.clip, clips.walk, ph), ww);
    if (rw > 0) addLimbPose(P, this.sample(this.clip, clips.run, ph), rw);
    let dive = 0;
    if (c.attack >= 0) {
      const a = c.attack, act = m[keys.action], attack = row.attacks.find(value => value.action === act);
      const held = a >= 1 ? (m[keys.held] ?? 0) + c.dt : 0;
      m[keys.held] = held;
      const w = 1 - step(held, ...row.hold);
      if (w > 0) {
        const k = w * (attack?.weight ?? 1);
        scaleLimbPose(P, 1 - k);
        addLimbPose(P, this.sample(this.clip, attack?.clip ?? row.defaultAttack, a, c.t), k);
        if (attack?.suppressLook === true) dive = k;
      }
    } else m[keys.held] = 0;
    const f = Math.max(c.flinch, c.brace * row.brace);
    if (f > 0.01) addLimbPose(P, this.sample(this.clip, clips.hit, 1 - f, c.t), 1);
    if (c.lookWeight > 0.001) {
      const look = lookAngles(c, r.at[this.head]?.y ?? row.look.fallbackHeight, row.look.yaw, row.look.up, row.look.down);
      const k = (1 - rw * row.look.runFade) * (1 - dive);
      P.neckYaw += look.yaw * row.look.neckYaw * k; P.headYaw += look.yaw * row.look.headYaw * k; P.headPitch -= look.pitch * row.look.headPitch * k;
    }
    return P;
  }
}

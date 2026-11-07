import type { AnimalRigJoint } from '../../shared/engine/entities/animalRig';

// Historical contract oracle; production consumers use the data-driven owners.
/** Numeric biped stride coefficients; omitted rest/brace terms use the ordinary weighted stance. */
export interface CreatureStrideProfile {
  readonly hip: number; readonly knee: number; readonly spread: number;
  readonly hipBrace?: number; readonly hipRest?: number;
  readonly kneeBrace?: number; readonly kneeRest?: number; readonly kneeFold?: number; readonly footRest?: number;
}

/** Pose six borrowed leg joints from a caller-owned gait/death frame. All inputs and joints preflight before writes. */
export function poseCreatureStride(bones: Readonly<Record<string, AnimalRigJoint>>, phase: number, moving: number,
  brace: number, kneel: number, topple: number, profile: CreatureStrideProfile, bend = 0): void {
  const hipBrace = profile.hipBrace ?? .1, hipRest = profile.hipRest ?? .1;
  const kneeBrace = profile.kneeBrace ?? .15, kneeRest = profile.kneeRest ?? .12, kneeFold = profile.kneeFold ?? 1.9, footRest = profile.footRest ?? .1;
  if (!Number.isFinite(phase) || !Number.isFinite(moving) || !Number.isFinite(brace) || !Number.isFinite(kneel) || !Number.isFinite(topple) || !Number.isFinite(bend)
    || !Number.isFinite(profile.hip) || !Number.isFinite(profile.knee) || !Number.isFinite(profile.spread)
    || !Number.isFinite(hipBrace) || !Number.isFinite(hipRest) || !Number.isFinite(kneeBrace) || !Number.isFinite(kneeRest) || !Number.isFinite(kneeFold) || !Number.isFinite(footRest)) throw new RangeError('Invalid creature stride frame');
  const lh = bones['legL_hip'], lk = bones['legL_knee'], lf = bones['legL_foot'];
  const rh = bones['legR_hip'], rk = bones['legR_knee'], rf = bones['legR_foot'];
  if (lh === undefined || lk === undefined || lf === undefined || rh === undefined || rk === undefined || rf === undefined) throw new Error('Missing creature stride joint');
  for (let side = 0; side < 2; side++) {
    const left = side === 0, sx = left ? 1 : -1, swing = Math.sin(phase + (left ? 0 : Math.PI));
    const hip = left ? lh : rh, knee = left ? lk : rk, foot = left ? lf : rf;
    hip.rotation.set(-profile.hip * swing * moving - hipBrace * brace - hipRest + .15 * kneel - .4 * topple - bend * .5, 0, sx * profile.spread);
    knee.rotation.set((profile.knee + .4 * Math.max(0, swing)) * moving + kneeBrace * brace + kneeRest + kneeFold * kneel + bend, 0, 0);
    foot.rotation.set(-.15 * swing * moving - footRest - bend * .5, 0, 0);
  }
}

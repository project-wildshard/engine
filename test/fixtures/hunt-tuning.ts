import type { HuntTuning } from '../../src/shared/engine/ai/huntPattern';

/** Explicit neutral hunting numbers for the made-up roster lifecycle controls. */
export const FIXTURE_HUNT_TUNING: HuntTuning = {
  hp: 60, sightRange: 30, sightRangeGraze: 14, sightCone: 55 * Math.PI / 180,
  hearStill: 3, hearCrouch: 6, hearWalk: 12, hearSprint: 24,
  noticeRate: 0.3, forgetRate: 0.3, alertAt: 0.45, boltAt: 1,
  freezeMin: 4, freezeMax: 7, relaxAfter: 3.5, panicDist: 6,
  runSpeed: 6, trotSpeed: 3.2, fleeMinTime: 1.5, fleeUntil: 35, fleeUntilMax: 50, fleeMaxTime: 8, lookBack: 2.5,
  waryTime: 10, waryBoost: 1.2, herdAlertRadius: 8, herdBoltDelayMin: 0.4, herdBoltDelayMax: 1.2,
  impactSpook: 4, impactAlert: 10,
};

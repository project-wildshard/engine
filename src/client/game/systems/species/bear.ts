import type { SpeciesRow } from '@wildshard/engine/ai/species';
import type { HuntTuning } from '@wildshard/engine/ai/hunt';

export const BEAR_TUNING: HuntTuning = {
  hp: 220, sightRange: 45, sightRangeGraze: 30, sightCone: 70 * Math.PI / 180,
  hearStill: 6, hearCrouch: 12, hearWalk: 25, hearSprint: 45,
  noticeRate: 0.8, forgetRate: 0.15, alertAt: 0.3, boltAt: 0.6,
  freezeMin: 1.0, freezeMax: 2.0, relaxAfter: 3, panicDist: 14,
  runSpeed: 7.0, trotSpeed: 3.5, fleeMinTime: 3, fleeUntil: 60, fleeUntilMax: 90, fleeMaxTime: 12, lookBack: 2,
  waryTime: 30, waryBoost: 1.3, herdAlertRadius: 20, herdBoltDelayMin: 0.3, herdBoltDelayMax: 1.0,
  impactSpook: 20, impactAlert: 80,
  stalk: { detect: 40, speed: 2.5, giveUp: 60, rechargeCd: 1.5, huffMin: 1.8, huffMax: 3.2, roar: 'bear_roar', fleeBelowHp: 0.2, fleeChance: 0.5 },
};
export const BEAR: SpeciesRow = {
  lockable: true,
  id: 'kit.creature.bear', kind: 'bear', label: 'Bear', aggressive: true,
  chargeWindup: 0.65, ringRadius: 7.5, trampleRadius: 0.75,
  walkSpeed: 1.0, chargeSpeed: 9, chargeDamage: 35, tuning: BEAR_TUNING,
  sounds: { call: 'bear_growl', hurt: 'bear_hurt' },
  variants: [
    { id: 'black', label: 'Black bear', weight: 37, rarity: 'common', scale: [1.3, 1.4], hp: 220 },
    { id: 'black-blaze', label: 'Black bear', weight: 18, rarity: 'common', scale: [1.3, 1.4], hp: 220 },
    { id: 'brown', label: 'Brown bear', weight: 30, rarity: 'uncommon', scale: [1.6, 1.75], hp: 320,
      mods: { damageTaken: 0.85, chargeDamage: 45, relentless: true } },
    { id: 'black-old', label: 'Old Blackpaw', weight: 10, rarity: 'rare', scale: [1.65, 1.65], hp: 330,
      mods: { chargeDamage: 42, relentless: true, chargeDist: 1.2 } },
    { id: 'brown-old', label: 'Grizzled Sow', weight: 5, rarity: 'rare', scale: [2.0, 2.0], hp: 480,
      mods: { damageTaken: 0.8, chargeDamage: 55, relentless: true, chargeDist: 1.3, speed: 1.05 } },
  ],
};

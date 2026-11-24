import type { SpeciesRow } from '@wildshard/engine/ai/species';
import type { HuntTuning } from '@wildshard/engine/ai/hunt';

const BOAR_TUNING: HuntTuning = {
  hp: 100, sightRange: 22, sightRangeGraze: 14, sightCone: 60 * Math.PI / 180,
  hearStill: 4, hearCrouch: 7, hearWalk: 14, hearSprint: 28,
  noticeRate: 0.5, forgetRate: 0.2, alertAt: 0.35, boltAt: 1.0,
  freezeMin: 1.5, freezeMax: 2.8, relaxAfter: 4, panicDist: 10,
  runSpeed: 6.8, trotSpeed: 3.6, fleeMinTime: 2, fleeUntil: 40, fleeUntilMax: 60, fleeMaxTime: 10, lookBack: 2,
  waryTime: 20, waryBoost: 1.5, herdAlertRadius: 12, herdBoltDelayMin: 0.2, herdBoltDelayMax: 0.7,
  impactSpook: 7, impactAlert: 18,
};
export const BOAR: SpeciesRow = {
  lockable: true,
  id: 'kit.creature.boar', kind: 'boar', label: 'Boar', aggressive: true,
  chargeWindup: 0.55, ringRadius: 6.5, trampleRadius: 0.45,
  walkSpeed: 1.1, chargeSpeed: 7.5, chargeDamage: 25, tuning: BOAR_TUNING,
  sounds: { call: 'boar_grunt', hurt: 'boar_squeal' },
  variants: [
    { id: 'boar', label: 'Boar', weight: 49, rarity: 'common', scale: [0.95, 1.1] },
    { id: 'sow', label: 'Sow', weight: 26, rarity: 'common', scale: [0.8, 0.9], hp: 70 },
    { id: 'black', label: 'Black boar', weight: 10, rarity: 'uncommon', scale: [1.0, 1.15] },
    { id: 'big', label: 'Big boar', weight: 8, rarity: 'uncommon', scale: [1.25, 1.25], hp: 140 },
    { id: 'scarback', label: 'Scarback', weight: 3, rarity: 'rare', scale: [1.3, 1.3], hp: 180, mods: { chargeDist: 1.6, chargeDamage: 32 } },
    { id: 'ironhide', label: 'Old Ironhide', weight: 1, rarity: 'legendary', scale: [1.5, 1.5], hp: 300,
      mods: { damageTaken: 0.6, chargeDist: 1.8, chargeDamage: 40, relentless: true, speed: 1.05 } },
  ],
};

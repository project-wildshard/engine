import type { FirearmProfile } from './firearmProfile';

/** Existing carbine tuning retained as shard-owned data during the weapon row conversion. */
export const AR15: FirearmProfile = {
  family: 'firearm', action: 'semi', magazine: 30, reserve: 90, interval: 0.09,
  reload: 1.6, autoReload: 0.35, damageScale: 0.55, range: 300, kick: 0.35 * (Math.PI / 180),
  spreadAds: 0.12, spreadHip: 1.1, spreadRadius: 'linear', bloomShot: 0.35, bloomMax: 1.6,
  movingSpread: 0, movingAimReduction: 0,
  brass: { count: 3, life: 1.4 }, tracer: { count: 3, life: 0.09, width: 3 },
  ads: { blend: 0.16, motion: 0.3, nearMargin: 0.03, sightY: 0.064, rearZ: 0.10, frontZ: -0.455, muzzleZ: -0.645 },
};

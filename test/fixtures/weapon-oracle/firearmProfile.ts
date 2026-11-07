/** Numeric firearm tuning of the weapon-oracle fixtures (QD7 LD6/7 moved it here from the SDK: no shipped reader left). */
export interface FirearmProfile {
  family: 'firearm'; action: 'semi' | 'lever'; magazine: number; reserve: number; interval: number;
  reload: number; autoReload: number; damageScale: number; range: number; kick: number;
  spreadAds: number; spreadHip: number; spreadRadius: 'linear' | 'sqrt'; bloomShot: number; bloomMax: number;
  movingSpread: number; movingAimReduction: number;
  brass: { count: number; life: number }; tracer: { count: number; life: number; width: number };
  ads: { blend: number; motion: number; nearMargin: number; sightY: number; rearZ: number; frontZ: number; muzzleZ: number };
}

import type * as v from 'valibot';
import type { MeleeWeaponProfileSchema } from '@wildshard/format/weaponProfiles';

type Swing = v.InferOutput<typeof MeleeWeaponProfileSchema>['moves']['combo'][number];

/** Shared starter swords' authored combat parameters; the separate move recipes own poses, trails and camera response. */
export const STARTER_MELEE_PROFILE: { family: "melee"; damage: number; reach: number; swingScale: number; cooldown: number; comboGap: number; chainLag: number; heavyCharge: number; moves: { combo: [{ windup: number; slashEnd: number; total: number; damage: number; stagger: number; sweep: number; }, { windup: number; slashEnd: number; total: number; damage: number; stagger: number; sweep: number; }, { windup: number; slashEnd: number; total: number; damage: number; stagger: number; sweep: number; }]; heavy: { windup: number; slashEnd: number; total: number; damage: number; stagger: number; sweep: number; }; }; lunge: { range: number; heavyRange: number; cone: number; stop: number; speed: number; minTime: number; maxTime: number; }; sweep: { rays: number; extensions: number[]; step: number; maxSamples: number; maxHits: number; }; } = {
  family: 'melee', damage: 12, reach: 2.2, swingScale: 1,
  cooldown: 0.08, comboGap: 0.6, chainLag: 0.02, heavyCharge: 0.45,
  moves: { combo: [
    { windup: 0.07, slashEnd: 0.235, total: 0.35, damage: 1, stagger: 0, sweep: 1 },
    { windup: 0.06, slashEnd: 0.22, total: 0.34, damage: 1, stagger: 0, sweep: -1 },
    { windup: 0.10, slashEnd: 0.28, total: 0.44, damage: 16 / 12, stagger: 0.25, sweep: 0.5 },
  ] satisfies [Swing, Swing, Swing], heavy: { windup: 0.06, slashEnd: 0.30, total: 0.62, damage: 2, stagger: 1, sweep: 0.35 } },
  lunge: { range: 4, heavyRange: 5, cone: 25 * Math.PI / 180, stop: 1.1, speed: 22, minTime: 0.08, maxTime: 0.15 },
  sweep: { rays: 5, extensions: [0.12, 0.24, 0.36, 0.48], step: 0.09, maxSamples: 6, maxHits: 8 },
} satisfies v.InferOutput<typeof MeleeWeaponProfileSchema>;
/** Existing iron upgrade changes only base contact damage. */
export const IRON_MELEE_PROFILE: { damage: number; family: "melee"; reach: number; swingScale: number; cooldown: number; comboGap: number; chainLag: number; heavyCharge: number; moves: { combo: [{ windup: number; slashEnd: number; total: number; damage: number; stagger: number; sweep: number; }, { windup: number; slashEnd: number; total: number; damage: number; stagger: number; sweep: number; }, { windup: number; slashEnd: number; total: number; damage: number; stagger: number; sweep: number; }]; heavy: { windup: number; slashEnd: number; total: number; damage: number; stagger: number; sweep: number; }; }; lunge: { range: number; heavyRange: number; cone: number; stop: number; speed: number; minTime: number; maxTime: number; }; sweep: { rays: number; extensions: number[]; step: number; maxSamples: number; maxHits: number; }; } = { ...STARTER_MELEE_PROFILE, damage: 28 };

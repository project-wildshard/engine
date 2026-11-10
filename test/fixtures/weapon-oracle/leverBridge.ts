import type * as v from 'valibot';
import { RangedAction, type RangedCycleEvent } from '@wildshard/engine/combat/Firearm';
import { parseNativeFirearmProfile, type FirearmWeaponProfileSchema } from '@wildshard/format/weaponProfiles';
import { LEVER_WEAPON_PROFILE } from '../engine-lift/nativeItemProfiles';
import type { FirearmProfile } from './firearmProfile';
import { AR15 } from './pineFirearmProfile';

/** Rounds in a full gun (the tube and the chamber) and the reserve a fresh rifle carries. */
export const MAGAZINE = LEVER_WEAPON_PROFILE.magazine, RESERVE_START = LEVER_WEAPON_PROFILE.reserve;
/** Seconds per cartridge through the loading gate. */
export const ROUND_TIME = LEVER_WEAPON_PROFILE.reload;
/** s to roll into / out of the loading pose (a reload's first round goes in RELOAD_IN after it starts) */
export const RELOAD_IN = LEVER_WEAPON_PROFILE.lever.reloadIn, RELOAD_OUT = LEVER_WEAPON_PROFILE.lever.reloadOut;
/** s after a dry pull on an empty gun before it reloads itself (and the window closes 5 s after it) */
export const AUTO_RELOAD_DELAY = LEVER_WEAPON_PROFILE.autoReload;

/** The lever-action's numbers: the hitscan (damage, range, spread) and the presentation's. */
export const LEVER_PROFILE: FirearmProfile = {
  ...AR15, ...LEVER_WEAPON_PROFILE,
  kick: 1.25 * (Math.PI / 180),
  brass: { count: 4, life: 1.8 }, tracer: { count: 2, life: 0.09, width: 3 },
  ads: { blend: 0.17, motion: 0.3, nearMargin: 0.03, sightY: 0.045, rearZ: -0.13, frontZ: -0.512, muzzleZ: -0.535 },
};

/** Admit only the per-round lever/hitscan law this native owner actually hosts, before allocating or reading RNG. */
export function parseLeverProfile(input: unknown): v.InferOutput<typeof FirearmWeaponProfileSchema> & { lever: NonNullable<v.InferOutput<typeof FirearmWeaponProfileSchema>['lever']> } {
  const row = parseNativeFirearmProfile(input, 'lever');
  if (row.lever === undefined) throw new Error('Missing lever profile');
  return { ...row, lever: row.lever };
}

/** Existing page effect names; the data-only host yields them at the original phase boundaries. */
export type LeverHooks = Readonly<Record<RangedCycleEvent, () => void>>;

/** Pine's profile/save compatibility bridge; cycling and per-round transfer belong to RangedAction. */
export class LeverAction extends RangedAction.Cycle {
  constructor(store: { reserve: number }, input: unknown = LEVER_WEAPON_PROFILE) {
    const profile = parseLeverProfile(input);
    super(store, { magazine: profile.magazine, reload: profile.reload, ...profile.lever });
  }
  step(dt: number, autoDue: boolean, hooks?: LeverHooks): void {
    for (const event of this.events(dt, autoDue)) hooks?.[event]();
  }
}

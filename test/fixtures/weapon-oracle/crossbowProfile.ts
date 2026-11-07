import type * as v from 'valibot';
import { parseNativeFirearmProfile, type FirearmWeaponProfileSchema } from '@wildshard/format/weaponProfiles';
import { CROSSBOW_WEAPON_PROFILE } from '../../../src/shards/pine-hollow/generators/crossbowProfile';

/** The existing flight/view profile with admitted launch/contact clocks; view and stuck-bolt dressing remain native. */
export interface CrossbowProfile {
  family: 'crossbow'; quiver: number; speed: number; gravity: number; drag: number; radius: number; bury: number;
  reload: number; autoReload: number; cooldown: number; kick: number; adsBlend: number; adsMotion: number;
  maxFlying: number; maxStuck: number;
  spreadAds: number; spreadHip: number; spreadRadius: 'linear' | 'sqrt'; spreadAxisScale: 1 | 2;
  muzzle: number; substeps: number; lifetime: number; damageScale: number;
}
/** Refuse fields this native single-bolt owner cannot host before allocations or gameplay RNG. */
export function parseCrossbowProfile(input: unknown): v.InferOutput<typeof FirearmWeaponProfileSchema> {
  return parseNativeFirearmProfile(input, 'bolt');
}
/** Project the same admitted row into the shipping renderer-free flight law and page owner without replacing its view. */
export function crossbowProfile(input: unknown): CrossbowProfile {
  const p = parseCrossbowProfile(input), projectile = p.projectile;
  if (projectile.muzzle === undefined || p.spreadAxisScale === undefined) throw new Error('Missing admitted Pine bolt launch');
  return { family: 'crossbow', quiver: p.magazine + p.reserve, speed: projectile.speed, gravity: projectile.flight.gravity, drag: projectile.flight.drag,
    radius: projectile.radius, bury: 0.08, reload: p.reload, autoReload: p.autoReload, cooldown: p.interval,
    kick: 0.8 * (Math.PI / 180), adsBlend: 0.18, adsMotion: 0.3, maxFlying: projectile.pool, maxStuck: 200,
    spreadAds: p.spreadAds, spreadHip: p.spreadHip, spreadRadius: p.spreadRadius, spreadAxisScale: p.spreadAxisScale,
    muzzle: projectile.muzzle, substeps: projectile.substeps, lifetime: projectile.lifetime, damageScale: p.damageScale };
}
/** The page's numeric flight/view recipe is derived from the same declaration the native host admits. */
export const CROSSBOW_PROFILE: CrossbowProfile = crossbowProfile(CROSSBOW_WEAPON_PROFILE);

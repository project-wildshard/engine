/**
 * Detail tiers for Explore's DETAIL TIERS view (project/archive/2026-09-23-explore-world.md X7): build a model as another tier would, and the
 * budgets a frame is held to.
 *
 *   withTier('phone', () => new Palms(sky).build([spec]).mesh)   // TIER_CONFIG reads the phone table (and buildTier() is 'phone') while fn runs
 *
 * The model modules read `TIER_CONFIG.*` (palmFrondSegs, bushDetail, …) synchronously inside build(), so swapping the
 * live config object's fields for the call and putting them back is enough — nothing else runs in between.
 */
import { TIER, TIER_CONFIG, buildTier, _buildAs, type Tier } from '../core/tier';
import { TIER_TABLE } from '../render/tiers';

export const TIERS: readonly Tier[] = ['phone', 'desktop'];

export function withTier<T>(tier: Tier, fn: () => T): T {
  if (tier === TIER) return fn();
  const live = TIER_CONFIG as Record<string, unknown>;
  const saved = { ...live }, was = buildTier();
  for (const key of Object.keys(live)) if (key.includes('.')) Reflect.deleteProperty(live, key);
  Object.assign(live, TIER_TABLE[tier]);
  _buildAs(tier); // a level's own knob tables follow too (core/tier.ts buildTier)
  try { return fn(); } finally {
    _buildAs(was === TIER ? null : was);
    for (const k of Object.keys(live)) if (!(k in saved)) Reflect.deleteProperty(live, k);
    Object.assign(live, saved);
  }
}

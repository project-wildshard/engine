import type { Shardfile } from '@wildshard/format/shardSchema';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';

/**
 * TEMPORARY (ONE-FORMAT OF22b4 bridge, Driftwood; the OF27d row removes it): a runtime page whose client plan keeps
 * `population.product-creatures` draws the shard's creatures from its install rows (`actors/creature-install.json`), while
 * its server already stands them as declared rows. Until those rows carry real looks, the data client leaves them to that
 * feature: it registers no second look, loads no rig library for a placeholder look, and its mode is the one it had
 * before the rows came (`withoutRuntimeCreatures`).
 */
export const PRODUCT_CREATURES_FEATURE = 'population.product-creatures';

/** Whether the product's client plan draws the creatures itself (the plan is admitted later; this only reads its kinds). */
export function productCreaturesOwnPage(product: Pick<ShardFolder, 'has' | 'section'>): boolean {
  if (!product.has('client/plan')) return false;
  const plan: unknown = product.section('client/plan');
  if (typeof plan !== 'object' || plan === null || !('features' in plan) || !Array.isArray(plan.features)) return false;
  return plan.features.some((row: unknown) => typeof row === 'object' && row !== null && 'kind' in row && row.kind === PRODUCT_CREATURES_FEATURE);
}

/** The data client's source without the declared creatures and the rows only they read (species, looks, strikes): the
 *  plan draws the bodies and the runtime owns the shard's items (Driftwood binds `items`). */
export function withoutRuntimeCreatures(source: Shardfile): Shardfile {
  return { ...source, rows: { ...source.rows, species: [], looks: [], strikes: [] }, encounters: [],
    creatures: { ...source.creatures, brains: [], groups: [], spawns: [], perchBodies: [] } };
}

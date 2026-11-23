/** SHARD-COMPAT HS6a: the one place server code reads the page's `client/plan`. The server's feature reads (stealth entry,
 * combat targets, quest views, view programs, timed encounters, elite rows, portal rides, rope decks, the play area, the
 * sided-kind census) all come through here, so HS6c moves them onto a section of the server's own in one file, and
 * `client/plan` goes back to page-only. */
import { type ClientPlan, parseClientPlan } from '@wildshard/format/clientPlan';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';

/** One declared feature row. */
export type PlanFeature = ClientPlan['features'][number];
type PlanProduct = Pick<ShardFolder, 'has' | 'section'>;

const PLAN = 'client/plan';

/** Does `product` declare a plan at all? */
export function hasServerPlan(product: PlanProduct | undefined): boolean {
  return product?.has(PLAN) === true;
}

/** The plan `product` declares; it refuses a product with none, as `section()` does. */
export function serverPlan(product: Pick<ShardFolder, 'section'>): ClientPlan {
  return product.section(PLAN);
}

/** Every feature row `product` declares, or none when it has no plan. */
export function serverPlanFeatures(product: PlanProduct | undefined): readonly PlanFeature[] {
  return product === undefined || !hasServerPlan(product) ? [] : serverPlan(product).features;
}

/** The plan from raw decoded sections (a bake payload or a pack folder's map), parsed; undefined when absent. */
export function sectionsPlan(sections: ReadonlyMap<string, unknown> | undefined): ClientPlan | undefined {
  const raw = sections?.get(PLAN);
  return raw === undefined ? undefined : parseClientPlan(raw);
}

/** The raw plan value from decoded sections, or from the product, for a host that hands it on unparsed. */
export function rawServerPlan(sections: ReadonlyMap<string, unknown> | undefined, product: PlanProduct | undefined): unknown {
  return sections?.get(PLAN) ?? (hasServerPlan(product) && product !== undefined ? serverPlan(product) : undefined);
}

/** A product view over a parsed plan, for a reader that takes a product (`shardPlayArea`). */
export function planProduct(plan: ClientPlan): PlanProduct {
  return { has: name => name === PLAN, section: (() => plan) as never };
}

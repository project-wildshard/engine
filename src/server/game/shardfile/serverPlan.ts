/** SHARD-COMPAT HS6a: the one place server code reads a shard's feature plan. The server's feature reads (stealth entry,
 * combat targets, quest views, view programs, timed encounters, elite rows, portal rides, rope decks, the play area, the
 * sided-kind census) all come through here. HS6c: it reads the server's own `server/plan` section (format HS6b) first and
 * falls back to the page's `client/plan` only for a file written before the SDK wrote one (HS6d). SHARD-COMPAT CP16 keeps
 * the fallback: kept originals written before HS6d (Nalati r2, prod's head, to r6; Driftwood r4 to r9) carry no `server/plan`,
 * and HS6e's server/plan-only read stood them with no plan at all (`test/kept-originals-play.test.ts`). */
import { type ClientPlan, parseClientPlan } from '@wildshard/format/clientPlan';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';

/** One declared feature row. */
export type PlanFeature = ClientPlan['features'][number];
type PlanProduct = Pick<ShardFolder, 'has' | 'section'>;
type PlanSource = Pick<ShardFolder, 'section'> & Partial<Pick<ShardFolder, 'has'>>;
/** The untyped read of a section this engine's pinned format may not name yet. */
type AnySection = (name: string) => unknown;
/** The untyped presence check, for the same reason. */
type AnyHas = (name: string) => boolean;

/** The server's own plan (format HS6b), read first. */
const SERVER = 'server/plan';
/** The page's plan, read only when a file has no `server/plan` (written before HS6d). */
const PAGE = 'client/plan';

function planName(product: PlanSource): string {
  return product.has !== undefined && (product.has as AnyHas)(SERVER) ? SERVER : PAGE;
}

/** Does `product` declare a plan at all? */
export function hasServerPlan(product: PlanProduct | undefined): boolean {
  return product !== undefined && ((product.has as AnyHas)(SERVER) || product.has(PAGE));
}

/** The plan `product` declares; it refuses a product with none, as `section()` does. */
export function serverPlan(product: PlanSource): ClientPlan {
  return parseClientPlan((product.section as AnySection)(planName(product)));
}

/** Every feature row `product` declares, or none when it has no plan. */
export function serverPlanFeatures(product: PlanProduct | undefined): readonly PlanFeature[] {
  return product === undefined || !hasServerPlan(product) ? [] : serverPlan(product).features;
}

/** The raw plan from decoded sections (a bake payload or a pack folder's map). */
function rawSectionsPlan(sections: ReadonlyMap<string, unknown> | undefined): unknown {
  return sections?.get(SERVER) ?? sections?.get(PAGE);
}

/** The plan from raw decoded sections, parsed; undefined when absent. */
export function sectionsPlan(sections: ReadonlyMap<string, unknown> | undefined): ClientPlan | undefined {
  const raw = rawSectionsPlan(sections);
  return raw === undefined ? undefined : parseClientPlan(raw);
}

/** The raw plan value from decoded sections, or from the product, for a host that hands it on unparsed. */
export function rawServerPlan(sections: ReadonlyMap<string, unknown> | undefined, product: PlanProduct | undefined): unknown {
  return rawSectionsPlan(sections) ?? (product !== undefined && hasServerPlan(product) ? serverPlan(product) : undefined);
}

/** A product view over a parsed plan, for a reader that takes a product (`shardPlayArea`). */
export function planProduct(plan: ClientPlan): PlanProduct {
  const has: AnyHas = name => name === SERVER || name === PAGE;
  return { has, section: (() => plan) as never };
}

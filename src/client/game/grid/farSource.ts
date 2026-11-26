/**
 * QA 11-25 row 133: where a grid cell's far proxy comes from. A slug the page's inventory lists a baked `far.json` for
 * reads that folder; any other reads its own product's far rows (`readGridShardfileFar`'s `anyWorld`). But the inventory
 * says what the build baked, not what the server serves: `wildshard dev` boots a staging client whose inventory lists
 * Nine's baked far and serves the author's product, not that folder, so the cell's far fetch 404'd and the boot stopped
 * (`[shard-load] (fatal) far.json nine-dragon-stack: 404`). A baked far the server answers 404 for is read from the product,
 * and the page remembers it, so the slug's later reads (`keepFarFiles`) go to the product too.
 */

/** Slugs whose listed baked far this page's server does not serve. */
const unserved = new Set<string>();

/** Whether the page reads `slug`'s far from its baked folder: listed in the inventory and not found missing. */
export function bakedFarServed(slug: string, listed: boolean): boolean { return listed && !unserved.has(slug); }

/** A far proxy's source: the product's own far rows, or the baked folder's `far.json` response (not ok: the caller fails). */
export type FarSource<Far> = { readonly kind: 'product'; readonly far: Far } | { readonly kind: 'baked'; readonly response: Response };

/** The far source for `slug`: `product(anyWorld)` reads its product's far rows (null: none, so the baked folder's); `baked`
 *  fetches the baked `far.json`. A 404 there falls back to the product's rows when it has any. */
export async function farSource<Far>(slug: string, listed: boolean, ports: {
  readonly product: (anyWorld: boolean) => Promise<Far | null>;
  readonly baked: () => Promise<Response>;
}): Promise<FarSource<Far>> {
  const own = await ports.product(!bakedFarServed(slug, listed));
  if (own !== null) return { kind: 'product', far: own };
  const response = await ports.baked();
  if (response.status !== 404 || !listed) return { kind: 'baked', response };
  unserved.add(slug);
  const read = await ports.product(true);
  return read === null ? { kind: 'baked', response } : { kind: 'product', far: read };
}

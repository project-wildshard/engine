import type { ShardContext } from '../plugin/context';
import { isItemId } from '../../../shared/game/bag/itemCatalog';

/** The shard's own admitted item rows, registered on the page. OF23a: the session's kit registers its starter bag first
 *  (`kit.items`); a shard that declares the same kit harvest items for its species' drops (Pine's `legacyHarvestItems`)
 *  keeps the kit's row instead of registering it twice. */
export function installItemCatalogue(ctx: Pick<ShardContext, 'product'> & { readonly rows: Pick<ShardContext['rows'], 'item'> }): void {
  const own = ctx.product.section('combat/items').items.catalogue?.filter(item => !isItemId(item.id));
  if (own !== undefined && own.length > 0) ctx.rows.item(own);
}

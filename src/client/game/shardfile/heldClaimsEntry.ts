/** Client-only concrete held-claim phases. Product rows own the rig and native
 * item catalogue; entered loans preserve the original preparation instance. */
import type { ShardContext } from '../plugin/context';
import { HeldClaims } from '../loadout/claims';
import { parseHeldSlots } from '@wildshard/format/heldArms';
import { entryOwner, publishEntryOwner } from '../../../shared/game/shardfile/entryOwners';

const ended = (ctx: ShardContext): boolean => ctx.scope.disposed || ctx.scope.disposing;

/** Kit preparation precedes creature rows; publication never transfers native
 * disposal or creates an item/save authority. */
export async function prepareHeldClaimsEntry(ctx: ShardContext, id: string, source?: { readonly slots: string; readonly library: string }): Promise<void> {
  if (ended(ctx)) throw new Error('Held claim entry owner has ended');
  const product = ctx.product, scope = ctx.scope, read = product.json;
  const live = (): void => { if (ended(ctx) || ctx.scope !== scope || ctx.product !== product || product.json !== read) throw new Error('Held claim preparation owner changed'); };
  const held = await scope.run(async () => {
    if (source === undefined) return HeldClaims.prepare(ctx);
    const input = await product.json<unknown>(source.slots); live();
    const rows = parseHeldSlots(input);
    if (rows.id !== id) throw new Error('Held slot entry identity differs');
    const slots = HeldClaims.fromFolderSlots(product, rows, source.library);
    await slots.prepareSlotSources(ctx); live(); return slots;
  });
  live();
  if (ended(ctx)) throw new Error('Held claim entry owner ended during preparation');
  publishEntryOwner(ctx.scope, 'claims', id, held);
}

/** Install the same prepared claims after creature registration and before the
 * ordinary kit catalogue, retaining all original native item ids and order. */
export function installHeldClaimsEntry(ctx: ShardContext, id: string, preparation:'kit'|'world'='kit'): void {
  const held=entryOwner(ctx.scope,'claims',id);
  if(preparation==='world')held.install(ctx,id);else held.install();
}

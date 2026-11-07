import { ShardPlugin, type ShardContext } from '../plugin/context';
import type { prepareHybridShard as PrepareHybrid } from '../shardfile/hybrid';

/** A shard's declared home/stage ownership (its manifest's `bindings.entry`): Driftwood false/declared, Nalati and Nine
 * true/declared, Pine true/runtime. Data at the one entry, never a shard-name lookup. */
export interface ClientPlanEntryPolicy { readonly retainHomeRuntime: boolean; readonly stagesOwner: 'declared' | 'runtime' }

/** Admit the product's compiled client plan as the shard's staged plugin: its data client plus the client-plan resident,
 * with the declared ownership. The page's residency owner and image scope come from the boot context. An injected
 * preparation port preserves trusted fixture/host admission checks. */
export async function prepareClientPlanShard(ctx: ShardContext, policy: ClientPlanEntryPolicy,
  prepare?: typeof PrepareHybrid): Promise<ShardPlugin> {
  if (!ctx.product.has('client/plan') || ctx.product.shardfile.runtime === null) throw new Error('Client-plan entry requires its compiled runtime declaration');
  // the hybrid admission stays its own lazy chunk, fetched when world() runs (as before LD9)
  return (prepare ?? (await import('../shardfile/hybrid')).prepareHybridShard)(ctx.product, { firstParty: true }, { residencyContext: ctx,
    retainHomeRuntime: policy.retainHomeRuntime, stagesOwner: policy.stagesOwner,
    catalogue: [], items: new Map(), recipes: new Map(), voices: () => new Map(),
    icon: () => { throw new Error('Client-plan runtime has no declared item icon'); },
  });
}

/** The one built-in shard entry (LD9): world() admits the client plan once, then kit/play run that same composite in the
 * staged order world → native world → world-bindings, native kit → plan kit, prepare-play → native play → plan play. No
 * service runs on import; an injected preparation port keeps trusted fixture/host admission checks. */
export function declaredClientPlanEntry(policy: ClientPlanEntryPolicy,
  prepare: (ctx: ShardContext, policy: ClientPlanEntryPolicy) => Promise<ShardPlugin> = prepareClientPlanShard): {
  default: new () => Required<ShardPlugin>;
} {
  return { default: class extends ShardPlugin {
    private composite: ShardPlugin | undefined;
    override async world(ctx: ShardContext): Promise<void> {
      this.composite = await prepare(ctx, policy);
      await this.composite.world?.(ctx);
    }
    override async kit(ctx: ShardContext): Promise<void> {
      if (this.composite === undefined) throw new Error('Client-plan world is not admitted');
      await this.composite.kit?.(ctx);
    }
    override async play(ctx: ShardContext): Promise<void> {
      if (this.composite === undefined) throw new Error('Client-plan world is not admitted');
      await this.composite.play?.(ctx);
    }
  } };
}

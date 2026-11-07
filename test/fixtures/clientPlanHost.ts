import { ShardPlugin, type ShardContext } from '../../src/client/game/plugin/context';
import { admitClientPlan, installClientPhase, type AdmittedClientPlan, type ClientPhase } from '../../src/client/game/shardfile/clientPlan';

/** A modern host fixture for the one client-plan entry (LD9's `declaredClientPlanEntry(policy, prepare)`): it installs the
 * admitted plan's finite phases on the entry's own scope in the staged order (world → world-bindings, kit, prepare-play →
 * play) without a data client, so a test reaches the plan's features with no product world. Admission runs once, at world. */
export function clientPlanPhases(): Promise<ShardPlugin> {
  let plan: AdmittedClientPlan | undefined;
  const phase = async (ctx: ShardContext, name: ClientPhase): Promise<void> => {
    plan ??= admitClientPlan(ctx.product.section('client/plan'), ctx.product);
    await installClientPhase(ctx, plan, name, ctx.scope);
  };
  return Promise.resolve(new class extends ShardPlugin {
    override async world(ctx: ShardContext): Promise<void> { await phase(ctx, 'world'); await phase(ctx, 'world-bindings'); }
    override async kit(ctx: ShardContext): Promise<void> { await phase(ctx, 'kit'); }
    override async play(ctx: ShardContext): Promise<void> { await phase(ctx, 'prepare-play'); await phase(ctx, 'play'); }
  }());
}

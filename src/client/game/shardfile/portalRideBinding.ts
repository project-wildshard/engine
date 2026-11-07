/** The walk-in portal ride's page half (G478 'walk-in-portal-ride'): the veil and the page's step. The ride's law is
 * `shared/shardfile/portalRide.ts`, which the server runs too; the page draws only the veil. No shard identifier or
 * callback enters here. */
import * as v from 'valibot';
import { DeclaredPortalRideSchema, type DeclaredPortalRideRows } from '@wildshard/format/portalRide';
import type { PanelNode } from '@wildshard/engine/ui/panel';
import { createPortalRide } from '../../../shared/game/shardfile/walkInPortalRide';
import { bindPortalLane, portalRider, portalRings, type PortalFacts, type PortalRide, type PortalRideRows as RideRows, type PortalSource } from '../../../shared/game/shardfile/portalRide';
import type { ShardContext } from '../plugin/context';

/** A page's ride rows: the law's, and the veil it draws. */
export type PortalRideRows = RideRows & { readonly veil: PanelNode };

/** Snapshot the entered owners before asynchronous preparation; admission never binds their replacements. */
function portalOwner(ctx: Pick<ShardContext, 'game' | 'scope'>, declared: ShardContext | null) {
  const scope = ctx.scope, game = ctx.game, runtime = game.runtime;
  if (runtime === undefined) throw new Error('The portal ride needs its entered world');
  const world = runtime.world;
  if (world === null) throw new Error('The portal ride needs its entered world');
  const app = declared?.app, product = declared?.product, source = product?.shardfile;
  const play = runtime.play, progress = play?.progress;
  const check = (): void => {
    if (ctx.scope !== scope || scope.disposed || scope.disposing) throw new Error('Portal ride owner has ended');
    if (ctx.game !== game || game.runtime !== runtime || runtime.world !== world) throw new Error('Portal ride world owner was replaced');
    if (declared !== null && (declared.app !== app || declared.product !== product || product.shardfile !== source
      || runtime.play !== play || play?.progress !== progress)) throw new Error('Portal ride declared owner was replaced');
  };
  check();
  return { world, check };
}

/** The page's ride: its veil panel in the HUD and its step after the player's, for the level's lifetime. */
export function installPortalRide(ctx: Pick<ShardContext, 'game' | 'system' | 'scope'>, source: PortalSource, rows: PortalRideRows, facts: PortalFacts): Promise<PortalRide> {
  return installPageRide(ctx, source, rows, facts);
}

/** Enter one admitted fixed portal declaration using the runtime's original ledger and progress owner. */
export async function installDeclaredPortalRide(ctx: ShardContext, input: DeclaredPortalRideRows): Promise<PortalRide> {
  const owner = portalOwner(ctx, ctx), source = ctx.product.shardfile;
  const rows = v.parse(DeclaredPortalRideSchema, input); owner.check();
  const ride = await installPageRide(ctx, source, rows, ctx);
  return ride;
}

async function installPageRide(ctx: Pick<ShardContext, 'game' | 'system' | 'scope'>, source: PortalSource, rows: PortalRideRows, facts: PortalFacts | ShardContext): Promise<PortalRide> {
  const declared = typeof facts === 'function' ? null : facts, original = portalOwner(ctx, declared), world = original.world;
  const [{ declarePanel }, { mountUi, uiScope }, { bindRuntimeLedger, projectRuntimeFacts }] = await Promise.all([import('@wildshard/engine/ui/panel'), import('@wildshard/engine/ui/ownership'), import('../../../shared/game/plugin/runtimeRows')]);
  original.check();
  // Validate the director, traversal and detached panel before a ledger, mounted veil or system can be allocated.
  const lane = createPortalRide(portalRings(source, rows)), rider = portalRider(world.player, () => world.physics, source);
  const panel = declarePanel(rows.veil);
  const emit = typeof facts === 'function' ? facts : projectRuntimeFacts(bindRuntimeLedger(facts, facts.product.shardfile, facts.product.slug), facts.game.runtime?.play?.progress);
  original.check();
  // O18: the veil belongs to this entered scope, even after the asynchronous module read.
  const owner = uiScope('PortalVeil', ctx.scope);
  mountUi(panel.root, owner);
  const ride = bindPortalLane(rider, k => { panel.style('', 'opacity', k.toFixed(3)); panel.style('', 'display', k > 0 ? 'block' : 'none'); }, lane, rows.landings, emit);
  let live = true;
  owner.onDispose(() => { if (ride.busy()) rider.hold(false); live = false; });
  ctx.system({ id: 'game.portal-ride', phase: 'update', after: ['engine.player.update'], run: dt => { if (live) ride.step(dt); } });
  return ride;
}

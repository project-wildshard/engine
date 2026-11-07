/** G677: the original entered stealth, mounted and weapon bindings as rows. */
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import type { ShardContext } from '../plugin/context';
import type { HeldSlotKit } from '../loadout/claims';
import { clientWildlifeState } from '../../../shared/game/population/wildlifeOwner';
import { pageAir } from '../population/pageAir';
import { enterClientRiding, type PageRidingView } from '../riding/client';
import { StealthController } from '../stealth/controller';
import { entryOwner, presentEntryOwner, publishEntryOwner } from '../../../shared/game/shardfile/entryOwners';
import { StealthRowsSchema } from '@wildshard/format/stealth';
import { parse } from 'valibot';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';

type EntryRows = Extract<ClientFeatureRow, {kind: 'stealth.entry'}>;

/** Reserve at world admission, before the original post-kit controller binds. */
export function prepareClientStealthEntry(ctx: ShardContext): void {
  const rows = parse(StealthRowsSchema, ctx.product.section('player/stealth'));
  ReturnProgram.prepareMemory(rows.program, ctx.scope);
}

/** Keep the original multiplier receiver and shot/impact order. No replacement
 * weapon, creature roster, mount, clock or persistence owner is constructed. */
export function bindStealthWeapons(ctx: ShardContext, row: EntryRows, stealth: StealthController,
  kit: HeldSlotKit, populationOwner: ReturnType<typeof clientWildlifeState>, riding: PageRidingView): void {
  const runtime = ctx.game.runtime, player = runtime?.world?.player, scope = ctx.scope;
  const population = populationOwner.wildlife;
  if (runtime === undefined || player === undefined || population === null) throw new Error('Stealth weapons require their original player and population');
  const valid = (): void => {
    if (scope.disposed || scope.disposing || ctx.scope !== scope || ctx.game.runtime !== runtime || runtime.world?.player !== player
      || entryOwner(scope, 'stealth', row.owner) !== stealth || entryOwner(scope, 'riding-play', row.riding) !== riding
      || populationOwner.wildlife !== population || entryOwner(scope, 'claims', row.claims).pageKit(ctx) !== kit) throw new Error('Stealth weapon owner left or changed');
  };
  valid();
  const bow = kit.bow(row.bow), previous = bow.damageMultiplier;
  const multiplier: NonNullable<typeof previous> = hit => { valid(); return (previous?.(hit) ?? 1) * stealth.sneakMultiplier(); };
  bow.damageMultiplier = multiplier;
  scope.onDispose(() => { if (bow.damageMultiplier === multiplier) bow.damageMultiplier = previous; });
  ctx.on('weapon.fired', () => {
    valid(); stealth.noteShot(); kit.polearm(row.melee).damageScale = stealth.sneakMultiplier(); pageAir.lastShotT = ctx.app.clock.now;
  });
  ctx.on('weapon.impact', ({point}) => {
    valid();
    if (Math.hypot(point.x - player.position.x, point.z - player.position.z) < row.impactExclusion) return;
    population.disturb(point.x, point.z); riding.noteShot(point.x, point.z);
  });
  ctx.system({id: row.frame.id, phase: 'update', after: [...row.frame.after], before: [...row.frame.before], run: (dt, time) => {
    valid(); stealth.updateSources(dt, time, {population, riding, kit, grass: pageAir});
  }});
}

/** Attach night actors, construct stealth, enter riding and bind the original
 * bow in their existing order, after native animals and equipment are ready. */
export function installClientStealthEntry(ctx: ShardContext, row: EntryRows): void {
  const runtime = ctx.game.runtime, world = runtime?.world, play = runtime?.play;
  if (ctx.scope.disposed || ctx.scope.disposing || runtime === undefined || world === undefined || world === null || play === undefined || play === null)
    throw new Error('Stealth entry requires its live world and play owners');
  const night = entryOwner(ctx.scope, 'timed-encounters', row.night), claims = entryOwner(ctx.scope, 'claims', row.claims);
  const kit = claims.pageKit(ctx), population = clientWildlifeState(ctx);
  if (kit === null || population.wildlife === null || presentEntryOwner(ctx.scope, 'stealth', row.owner) !== null
    || presentEntryOwner(ctx.scope, 'riding-play', row.riding) !== null) throw new Error('Stealth entry requires its unbound original owners');
  const rows = ctx.product.section('player/stealth');
  ctx.scope.run(() => {
    night.attach(play.animals);
    const stealth = new StealthController(ctx, world.player, rows);
    const riding = enterClientRiding(ctx, claims);
    if (entryOwner(ctx.scope, 'riding-play', row.riding) !== riding) throw new Error('Stealth entry requires its original riding publication');
    if (row.debugRiding !== undefined) ctx.debug.expose(row.debugRiding, riding);
    publishEntryOwner(ctx.scope, 'stealth', row.owner, stealth);
    bindStealthWeapons(ctx, row, stealth, kit, population, riding);
  });
}

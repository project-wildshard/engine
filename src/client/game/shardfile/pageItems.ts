import { Vector3 } from 'three';
import type { Actor } from '@wildshard/engine/combat/pipeline';
import type { ItemFamily } from '@wildshard/engine/combat/itemFamilies';
import { playerModes } from '@wildshard/engine/player/modes';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { ShardContext } from '../plugin/context';
import type { RuntimeItemPorts, RuntimeMeleePorts, bindRuntimeItems } from '../plugin/headless';
import { installEnteredRuntimeInput, retainsRuntimeServices } from '../shard/retainedHooks';
import { declaredItemContext, installDeclaredItems, type DeclaredItems } from '../../../shared/game/shardfile/items';

type RuntimeWeaponFamily = Extract<ItemFamily, { kind: 'weapon' }>;
/** Internal native item mechanics shared by the legacy runtime adapters and
 * compiled held.melee feature. Public authored inputs remain item/model rows. */
export function installPageItems(ctx: Pick<ShardContext, 'app' | 'scope' | 'game'>, source: Shardfile, ports: RuntimeItemPorts): DeclaredItems {
  if (source.items.rows.some(row => row.hook !== null && (ports.hooks?.get(row.id) === null || ports.hooks?.get(row.id) === undefined))) throw new Error('Runtime-bound items require their admitted composed hooks');
  const camera = (): NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>['game']['camera'] => {
    const world = ctx.game.runtime?.world; if (world === null || world === undefined) throw new Error('Runtime-bound items need the normal world'); return world.game.camera;
  };
  const player = (): NonNullable<ShardContext['app']['player']> => { const actor = ctx.app.player; if (actor === null) throw new Error('Player health has not entered play'); return actor; };
  const actor: Actor = { id: 'actor.player', get tags() { return player().tags; }, get state() { return player().state; }, get attributes() { return player().attributes; }, get alive() { return player().alive; }, applyDamage: (request) => player().applyDamage(request) };
  return installDeclaredItems(source.items, { scope: ctx.scope, actorId: actor.id, input: ctx.app.input, families: ports.kit ?? new Map(), icon: ports.icon,
    shardFamilies: { slug: source.identity.slug, families: ports.families }, contexts: 'runtime',
    aim: () => ({ origin: camera().getWorldPosition(new Vector3()), direction: camera().getWorldDirection(new Vector3()) }),
    runtime: row => ({ actor, combat: ctx.app.combat, active: () => ctx.app.state === 'play', targets: () => [], hook: row.hook === null ? null : ports.hooks?.get(row.id) ?? null,
      effect: (target, effect, from) => { const service = ctx.app.effects; if (service === null) throw new Error('Missing normal effect host'); service.apply(target, effect, from); },
    }),
  });
}

export function bindPageMelee<W extends ReturnType<RuntimeWeaponFamily['create']>>(
  ctx: Parameters<typeof bindRuntimeItems>[0], source: Shardfile, ports: RuntimeMeleePorts<W>): W {
  const primary = source.items.rows.find(row => row.id === source.items.loadout.primary);
  if (primary?.kind !== 'weapon') throw new Error('Declared melee needs its primary weapon row');
  const owner: { weapon: W | null } = { weapon: null };
  const family: RuntimeWeaponFamily = { kind: 'weapon',
    ...(primary.profile === undefined ? {} : { profiles: [primary.profile.family] }),
    ...(ports.presentation === undefined ? {} : { presentation: ports.presentation }),
    create: (row, spec, binding) => {
      if (owner.weapon !== null) throw new Error('Declared melee family must own one primary');
      const weapon = ports.create(row, spec, binding); owner.weapon = weapon; return weapon;
    },
  };
  const bound = installPageItems(ctx, source, { families: new Map([[primary.family, family]]), icon: ports.icon,
    ...(ports.hooks === undefined ? {} : { hooks: ports.hooks }) });
  if (owner.weapon === null || bound.primary !== owner.weapon) throw new Error('Declared melee primary differs from its owned instance');
  return owner.weapon;
}

export function installPageItemContexts(ctx: ShardContext, source: Shardfile): void {
  for (const row of source.items.contexts) {
    const definition = declaredItemContext(row, { get mode() { const player = ctx.game.runtime?.world?.player; return player === undefined ? ctx.app.player?.mode ?? 'foot' : playerModes(player).current(); },
      get item() { return ctx.app.equipment?.current.row.id ?? null; }, get flags() { return ctx.game.runtime?.hooks.questFlags?.() ?? []; } });
    const description = { rows: row.extra?.describe ?? [] };
    if (retainsRuntimeServices(ctx)) installEnteredRuntimeInput(ctx, definition, description);
    else { ctx.inputContext(definition); ctx.app.input.bindings.describe(description, ctx.scope); }
  }
}

import type { Vector3 } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { LevelContext } from '@wildshard/engine/level/context';
import type { Actor, CombatTag } from '@wildshard/engine/combat/pipeline';
import { hudSlots } from '@wildshard/engine/ui/hudSlots';
import { StatusIcons } from '../systems/effects/view';
import * as v from 'valibot';
import starterRows from '../../../shared/game/systems/effects/starterRows.json' with { type: 'json' };
import { bindPlayerEffects, selectEffectGrants, type EffectService } from '@wildshard/engine/combat/effects/EffectService';
import type { ShardContext } from '../plugin/context';
import { installEnteredRuntimeService, installRetainedPlayerEffects, retainsRuntimeServices } from '../shard/retainedHooks';
import { isOwnedId, isCosmetic } from '../../../shared/game/loot/Owned';
import type { EffectDef, CueId, EffectId } from '@wildshard/engine/combat/effects/types';
import { wirePage } from '../shardfile/wirePage';

/** The shared permanent cosmetic grant; authored finish identity and weapon determine its exclusive group. */
export const heldFinishEffect = (id: string, weapon: string): EffectDef => ({
  id: `effect.finish.${id}`, kind: 'permanent', stacking: 'none', tags: ['effect.cosmetic'], modifiers: [],
  grants: [`cosmetic.finish.${id}`], group: `finish.${weapon}`,
});

/** Client-only item effect presentation. Rows select native ownership grants and status UI;
 * player/weapon attribute storage and periodic damage remain engine-owned. */
export function installItemEffects(context: ShardContext): void {
  const items = context.product.shardfile.items, row = items.loadout.effects;
  if (row === undefined) return;
  const runtime = context.game.runtime, world = runtime?.world, play = runtime?.play;
  const effects = context.app.effects, health = context.app.player;
  if (world === undefined || world === null || play === undefined || play === null || effects === null || health === null)
    throw new Error('Item effects need native player and equipment services');
  const { player } = world, owned = play.owned, retained = retainsRuntimeServices(context);
  const grants = [...row.player, ...row.worn, ...row.weapons.flatMap(entry => entry.grants)];
  if (grants.some(grant => !isOwnedId(grant.key) || grant.unless?.some(key => !isOwnedId(key)) === true)
    || row.worn.some(grant => !isOwnedId(grant.key) || !isCosmetic(grant.key))) throw new Error('Unknown item effect ownership');
  const targets = row.weapons.map(entry => ({ grants: entry.grants, items: entry.items.map(id => {
    const item = items.rows.find(value => value.id === id);
    if (item?.kind !== 'weapon' || item.equipment?.legacySlot === undefined) throw new Error('Item effect needs a native equipment slot');
    return play.weapons.get(item.equipment.legacySlot);
  }) }));
  if (retained) installRetainedPlayerEffects(context, { movement: player, position: () => player.position });
  else bindPlayerEffects({ effects, target: health, movement: player, combat: context.app.combat, position: () => player.position, scope: context.scope });
  if (row.statuses) installStarterEffects(context, { player, health, effects }, retained ? install => { installEnteredRuntimeService(context, install); } : undefined);
  for (const entry of targets) for (const target of entry.items) effects.bind(target, () => { target.attributes['damage'] = Math.round(target.attributes['damage'] ?? 0); }, context.scope);
  const has = (id: string): boolean => isOwnedId(id) && owned.has(id);
  const worn = (id: string): boolean => isOwnedId(id) && isCosmetic(id) && owned.worn(id);
  const apply = (): void => {
    if (context.scope.disposed) return;
    const keys = grants.flatMap(grant => [grant.key].concat(grant.unless ?? []));
    const ownedKeys = new Set(keys.filter(has)), wornKeys = new Set(keys.filter(worn));
    if (row.player.length > 0 || row.worn.length > 0 || row.hitCap !== undefined)
      effects.sync(health, [...selectEffectGrants(row.player, ownedKeys), ...selectEffectGrants(row.worn, wornKeys),
        ...(row.hitCap !== undefined && Number.isFinite(context.manifest.fight?.maxHitDamage ?? Infinity) ? [{ id: row.hitCap }] : [])]);
    for (const entry of targets) for (const target of entry.items) effects.sync(target, selectEffectGrants(entry.grants, ownedKeys));
  };
  apply(); context.scope.onDispose(owned.onChange(apply));
  let previousStun=0;
  context.system({id:'game.effects.owner',phase:'update',run:()=>{
    const client=wirePage.client,frame=client?.latest;if(client===null||frame===undefined||frame===null)return;
    const owner=client.owner(frame),max=owner['maxHp'],stun=owner['statusStun'];
    if(typeof max==='number'&&max>0)health.attributes.maxHealth=max;
    if(row.statuses&&typeof stun==='number') {
      if(stun>0&&(previousStun<=0||stun>previousStun+0.1))effects.apply(health,'effect.stun',undefined,{duration:stun});
      else if(stun<=0&&previousStun>0)effects.remove(health,'effect.stun');
      previousStun=stun;
    }
  }});
}

/** Existing starter tuning; only the authored stun is applied by normal play, and importing installs no effects. */
const starterTag = v.custom<CombatTag>(value => typeof value === 'string' && /^.+\..+$/u.test(value));
const starterId = v.custom<EffectId>(value => typeof value === 'string' && value.startsWith('effect.'));
const starterCue = v.custom<CueId>(value => typeof value === 'string' && value.startsWith('cue.'));
const finite = v.pipe(v.number(), v.finite());
export const STARTER_EFFECTS: readonly EffectDef[] = v.parse(v.array(v.strictObject({
  id: starterId, kind: v.literal('timed'), duration: finite, tags: v.array(starterTag), grants: v.array(starterTag),
  modifiers: v.array(v.strictObject({ attr: v.string(), op: v.picklist(['add', 'mul', 'override']), value: finite })),
  stacking: v.union([v.literal('refresh'), v.strictObject({ max: v.pipe(finite, v.integer(), v.minValue(1)) })]),
  cue: starterCue, icon: v.string(), period: v.exactOptional(finite), tickDamage: v.exactOptional(finite),
})), starterRows);

type StatusMovement = Parameters<typeof bindPlayerEffects>[0]['movement'];
type StarterContext = Pick<LevelContext, 'app' | 'scope' | 'system' | 'on'> & { hud: Pick<LevelContext['hud'], 'widget'> };
/** An optional entered installer retires observers and icons while statuses remain player-owned. */
export function installStarterEffects(ctx: StarterContext, host: { player: StatusMovement & { position: Vector3 }; health: Actor | null; effects: EffectService | null },
  entered?: (install: (scope: Scope) => void) => void): void {
  const { player, health, effects } = host;
  if (health === null || effects === null) throw new Error('Starter effects need player health and effects services');
  if (entered === undefined) bindPlayerEffects({ effects, target: health, movement: player, combat: ctx.app.combat, position: () => player.position, scope: ctx.scope });
  let iconScope: Scope | undefined;
  let icons: StatusIcons | null = null;
  if (entered !== undefined) entered((scope) => {
    iconScope = scope;
    scope.onDispose(() => { icons?.root.remove(); icons = null; if (iconScope === scope) iconScope = undefined; });
  });
  ctx.system({ id: 'engine.effects.status', phase: 'update', run: () => {
    const active = effects.active(health);
    const status = active.some((effect) => effect.def.tags.some((tag) => tag.startsWith('status.')));
    if (status && icons === null) {
      icons = new StatusIcons();
      if (entered === undefined) ctx.hud.widget('band.3', icons.root, 80);
      else if (iconScope !== undefined) hudSlots.widget('band.3', icons.root, 80, iconScope);
    }
    if (icons !== null) { icons.update(active); icons.root.style.display = status ? '' : 'none'; }
  } });
  if (entered === undefined) ctx.on('player.died', ({ actor }) => {
    if (actor !== health) return;
    for (const effect of effects.active(health)) if (effect.def.tags.some((tag) => tag.startsWith('status.'))) effects.remove(health, effect.def.id);
  });
  ctx.scope.onDispose(() => { icons?.root.remove(); });
}

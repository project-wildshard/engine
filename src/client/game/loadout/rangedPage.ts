/** Client-only entered equipment/pickup/collection owners driven by JSON rows. */
import { Vector3 } from 'three';
import { perfLap } from '@wildshard/engine/core/perfLap';
import { practiceRoom } from '@wildshard/engine/core/practiceRoom';
import { isDev } from '@wildshard/engine/core/devMode';
import * as v from 'valibot';
import type { Scope } from '@wildshard/engine/app/scope';
import { WeaponPickup } from '@wildshard/engine/player/WeaponPickup';
import { applySkin, clearSkin, type SkinId } from '@wildshard/engine/player/Skins';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import { RangedPageSchema, type RangedPageRows } from '@wildshard/format/rangedPage';
import { forestPage } from '../shardfile/forestPage';
import { HeldFinishes } from './finishes';
import { installHeldLoadout, type HeldLoadout } from './held';
import { ItemCatalogue } from '../../../shared/game/loadout/itemCatalogue';
import { ClaimedPickupRoster } from '../loot/runtime';
import { HeldLauncher } from '../weapons/heldLauncher';
import { HeldFirearm } from '../plugin/heldFirearm';
import { Bow } from '../weapons/Bow';
import { eliteStream } from '../../../shared/game/quest/eliteStreams';
import { readPageEliteRows } from '../quest/elitePage';
import { installRoamingCombat, type RoamingCombat } from '../combat/roamingSession';
import { installCollectionCompendium } from '../models/collectionWall';
import { installItemEffects } from './effects';
import { installEnteredRuntimeService } from '../shard/retainedHooks';
import type { ShardContext } from '../plugin/context';
import { finishForestPageAudio } from '../audio/forestPage';
import { declaredLootEconomy } from '../../../shared/game/shard/declaredRows';
import { registerLootTable, rollLoot } from '../loot/tables';
import { readLootTables } from '../../../shared/game/loot/tableRows';
import type { DeclaredAmbience } from '@wildshard/engine/audio/declaredAmbience';

export interface RangedPage {
  readonly rows: RangedPageRows; readonly loadout: HeldLoadout; readonly fights: RoamingCombat;
  readonly compendium: ReturnType<typeof installCollectionCompendium>;
  readonly ambience: DeclaredAmbience;
}
const pages = new WeakMap<Scope, Map<string, RangedPage>>();
export function rangedPage(scope: Scope, id: string): RangedPage { const page = pages.get(scope)?.get(id); if (scope.disposed || page === undefined) throw new Error('Missing entered ranged page'); return page; }
/** The existing bag save, finish catalogue and item catalogue remain the owners. */
export async function prepareRangedPage(ctx: ShardContext, input: unknown): Promise<void> {
  const rows = v.parse(RangedPageSchema, input), runtime = ctx.game.runtime;
  if (runtime === undefined) throw new Error('Ranged page requires its runtime');
  const finish = ctx.product.section('held/finishes').source;
  if (finish === undefined) throw new Error('Missing declared finish geometry');
  await HeldFinishes.prepare(ctx.product, ctx.scope);
  const kinds = new ItemCatalogue(ctx.product.shardfile.items).inventory.kinds;
  runtime.menu = { skins: () => runtime.play ? runtime.play.skins.cardRows(HeldFinishes.current(ctx.manifest.slug).cards) : [],
    onWearSkin: id => { runtime.hooks.wearFinish?.(id); }, skinsTitle: rows.menu.title,
    pack: { note: rows.menu.note, hint: rows.menu.hint, gearHint: rows.menu.gearHint, line: id => kinds.includes(id) ? rows.menu.lines[id] ?? rows.menu.noTrade : null } };
}
export async function installRangedPage(ctx: ShardContext, input: unknown): Promise<RangedPage> {
  const rows = v.parse(RangedPageSchema, input), runtime = ctx.game.runtime, world = runtime?.world, play = runtime?.play;
  if (runtime === undefined || world === undefined || world === null || play === undefined || play === null) throw new Error('Ranged page requires entered play services');
  if (pages.get(ctx.scope)?.has(rows.id) === true) throw new Error('Duplicate entered ranged page');
  const { game, sky, player, params } = world, { animals, weapons, skins, wearSkin, audio, music, hud, menu, touchUi, nolock } = play;
  const floor = forestPage(ctx.scope, rows.forest), slots = ctx.product.section('held/loadout');
  const rifle = weapons.get(slots.firearm.slot), bow = weapons.get(slots.bow.slot), launcher = weapons.get(slots.launcher.slot);
  if (!(rifle instanceof HeldFirearm) || !(bow instanceof Bow) || !(launcher instanceof HeldLauncher)) throw new Error('Ranged page requires declared weapon families');
  const elites = await readPageEliteRows(ctx.product, rows.elites);
  const random = (id: string): (() => number) => { const stream = eliteStream(elites, ctx.product.shardfile.identity.seed, 'pickup', id); return () => stream.next(); };
  runtime.hooks.wearFinish = id => {
    if (!HeldFinishes.current(ctx.manifest.slug).has(id)) return;
    const pick = skins.pick(id); if (!pick) return;
    if (pick.act === 'wear') { wearSkin(pick.skin); return; }
    clearSkin(pick.skin.weapon === slots.firearm.slot ? rifle.model : launcher.model); ctx.app.effects?.sync(weapons.get(pick.skin.weapon), []); skins.wear(pick.skin.weapon, null);
  };
  const economy = declaredLootEconomy(ctx.product.section('economy/loot').rows.loot, 'barter');
  for (const table of readLootTables(economy.tables)) registerLootTable(table, ctx.scope);
  const pickups = ctx.product.section('combat/items').items.pickups;
  if (pickups === undefined) throw new Error('Ranged page requires declared finish pickups');
  const drops = new ClaimedPickupRoster<SkinId>(pickups, { scene: game.scene, has: id => skins.has(id), random: () => ctx.app.rng.stream('loot').next(), visualRandom: random(rows.drops.stream),
    model: id => { const skin = HeldFinishes.current(ctx.manifest.slug).get(id), model = skin.weapon === slots.firearm.slot ? rifle.displayModel() : launcher.displayModel(); applySkin(model, skin, sky); return model; },
    enter: (_id, drop) => { runtime.interactables.push(drop.interactable); },
    take: id => { const skin = HeldFinishes.current(ctx.manifest.slug).get(id), label = rows.drops.labels[skin.weapon];
      if (label === undefined) throw new Error('Missing declared pickup family label');
      skins.own(skin.id); wearSkin(skin); if (skin.weapon === slots.firearm.slot) { weapons.unlock(slots.firearm.slot); weapons.select(slots.firearm.slot); }
      audio.hitMarker(); hud.toast(`${skin.name} ${label} — ${skin.blurb}`); },
  });
  ctx.on('actor.died', ({ actor }) => { const body = animals.animals.find(candidate => candidate.combatActor() === actor); if (body === undefined) return;
    const drop = drops.death(body, player.position, rollLoot('finish-drops', body).map(reward => reward.item)); if (drop === null || runtime.hooks.isElite?.(body) === true) return;
    drop.at.y = Math.max(drop.at.y, terrainHeight(drop.at.x, drop.at.z)); drops.spawn(drop.id, drop.at, true); });
  const loadout = installHeldLoadout(ctx, slots), pickup = rows.drops.rifle;
  const rifleDrop = ctx.scope.run(() => new WeaponPickup({ scene: game.scene, item: rifle.displayModel(), position: new Vector3(...pickup.at), tier: 'common', prompt: pickup.label, scale: pickup.scale, random: random(rows.drops.rifleStream) }));
  runtime.interactables.push(rifleDrop.interactable); rifleDrop.onNear = inside => { audio.pickupHum(inside); };
  rifleDrop.onPickup = () => { weapons.interact('quest.pickup'); weapons.unlock(slots.firearm.slot); weapons.select(slots.firearm.slot); audio.hitMarker(); music.sting('pickup'); hud.toast(pickup.toast); };
  if (loadout.hasRifle || pickup.parameters.includes(params.get('weapon') ?? '')) rifleDrop.dispose();
  runtime.hooks.disposeRifleDrop = () => { rifleDrop.dispose(); };
  runtime.hooks.updatePickups = (dt, time) => { rifleDrop.update(dt, time, game.renderer, game.camera); drops.update(dt, time, game.renderer, game.camera, player.position); };
  installItemEffects(ctx); await ctx.scope.run(() => animals.factory.prepareModels(rows.prewarm));
  const fights = await installRoamingCombat(ctx, await ctx.product.json(rows.combat)), row = rows.collection;
  const compendium = ctx.scope.run(() => installCollectionCompendium(new Map([['compendium', { context: ctx, chunkId: ctx.manifest.slug, game, camera: game.camera, hud, menu, animals, cabins: floor.cabins, interactables: runtime.interactables, weapons, touchUi, nolock }]]),
    { scope: ctx.scope, product: ctx.product, pack: row.pack, chalk: row.chalk, texture: row.texture }));
  const page = { rows, loadout, fights, compendium, ambience: await finishForestPageAudio(ctx, { rows, loadout, fights }) }, book = pages.get(ctx.scope) ?? new Map<string, RangedPage>();
  installDebugLap(ctx, page);
  book.set(rows.id, page); pages.set(ctx.scope, book); ctx.scope.onDispose(() => { book.delete(rows.id); }); return page;
}

/** Existing Developer perf tooling consumes declared spots and the page's own
 * encounter/music/body owners. It installs no gameplay trigger or clock. */
function installDebugLap(ctx: ShardContext, page: RangedPage): void {
  const row = page.rows.debugLap;
  if (row === undefined) return;
  const world = ctx.game.runtime?.world, play = ctx.game.runtime?.play;
  if (world === undefined || world === null || play === undefined || play === null) throw new Error('Perf lap requires its entered page');
  const { game, player } = world, { animals, music, hud } = play;
  installEnteredRuntimeService(ctx, scope => {
    let calmBefore = false;
    const previous = perfLap.host;
    const host = {
      game, shard: ctx.manifest.slug, spots: row.spots, player,
      busy: (): string | null => {
        if (!isDev()) return 'only in Developer';
        if (practiceRoom.open) return 'not in a practice room';
        const boss = page.fights.encounter.boss.state;
        if (boss !== 'dormant' && boss !== 'armed') return row.bossBusy;
        if (page.fights.elites.focus?.state === 'engaged') return 'not mid-fight (an elite)';
        if (music.state.mode === 'combat') return 'not mid-fight';
        for (let i = 0; i < Math.min(animals.animals.length, 512); i++) {
          const actor = animals.animals[i];
          if (actor === undefined || !actor.alive || actor.hidden) continue;
          if (['charge', 'stalk', 'attack'].includes(actor.state) && actor.position.distanceTo(player.position) < row.fightRadius) return 'not mid-fight (something is charging you)';
        }
        if (player.ride !== null || player.hover || player.carried) return 'not while riding / held';
        if (player.swimming) return 'not while swimming';
        return null;
      },
      hold: (on: boolean): void => { if (on) { calmBefore = animals.calm; animals.calm = true; } else animals.calm = calmBefore; },
      toast: (text: string): void => { hud.toast(text); },
    };
    perfLap.host = host;
    scope.onDispose(() => { if (perfLap.host === host) { if (perfLap.active) { host.hold(false); perfLap.active = false; } perfLap.host = previous; } });
  });
}

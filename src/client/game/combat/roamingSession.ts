/** Client-only roaming encounter/session composition over entered services. */
import * as THREE from 'three';
import * as v from 'valibot';
import { RoamingCombatSchema } from '@wildshard/format/roamingCombat';
import { bossEncounterPresentation } from '@wildshard/format/bossEncounter';
import { installBossEncounter, PageCombatSession, type BossEncounter } from '../Boss';
import { Elites, eliteGroundTell, type EliteRule } from '../Elite';
import { installRoamingBossProjection } from '../boss/roamingProjection';
import { enteredHeldLoadout } from '../loadout/held';
import { HeldFinishes } from '../loadout/finishes';
import { HeldLauncher } from '../weapons/heldLauncher';
import { HeldFirearm } from '../plugin/heldFirearm';
import { Bow } from '../weapons/Bow';
import { ITEMS } from '../../../shared/game/bag/itemCatalog';
import type { ItemId } from '../Inventory';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import { applySkin } from '@wildshard/engine/player/Skins';
import { lineOfSight } from '@wildshard/engine/physics/query';
import { EliteBar } from '@wildshard/engine/ui/EliteBar';
import { perfLap } from '@wildshard/engine/core/perfLap';
import { CatalogueScore } from '@wildshard/engine/audio/SetScore';
import { requireAudioProfile } from '@wildshard/engine/audio/audioProfiles';
import type { DeclaredSoundBank } from '@wildshard/engine/audio/declaredBank';
import { installEliteFeaturePage, readPageEliteRows } from '../quest/elitePage';
import { bindAdventurePersistence } from '../../../shared/game/quest/persistence';
import type { ShardContext } from '../plugin/context';
import { installEnteredRuntimeAttachment, installEnteredRuntimeObserver, installEnteredRuntimeService, retainsRuntimeServices } from '../shard/retainedHooks';

export interface RoamingCombat {
  readonly elites: Elites;
  readonly encounter: BossEncounter<Awaited<ReturnType<typeof installRoamingBossProjection>>>;
  readonly finishModel: (id: string) => THREE.Object3D;
  readonly weatherHold: () => number; readonly onPlayerDeath: () => boolean;
  readonly isElite: (actor: Animal) => boolean; readonly useSfx: (bank: DeclaredSoundBank) => void; readonly eliteEngaged: () => boolean;
}

/** No author callback, reward factory or weather query crosses this boundary. */
export async function installRoamingCombat(context: ShardContext, input: unknown): Promise<RoamingCombat> {
  const rows = v.parse(RoamingCombatSchema, input), runtime = context.game.runtime, world = runtime?.world, play = runtime?.play;
  if (runtime === undefined || world === undefined || world === null || play === undefined || play === null) throw new Error('Roaming combat requires its entered world');
  const source = context.product.shardfile, { game, sky, player } = world, { animals, weapons, audio, music } = play;
  const slots = context.product.section('held/loadout'), launcher = weapons.get(slots.launcher.slot), rifle = weapons.get(slots.firearm.slot), bow = weapons.get(slots.bow.slot);
  if (!(launcher instanceof HeldLauncher) || !(rifle instanceof HeldFirearm) || !(bow instanceof Bow)) throw new Error('Roaming combat requires its declared ranged families');
  const loadout = enteredHeldLoadout(context.scope, rows.loadout), session = context.scope.run(() => new PageCombatSession(context, rows.session)), ctx = session.context;
  const isItem = (id: string): id is ItemId => id in ITEMS;
  if (!isItem(rows.reward.trophy)) throw new Error('Missing declared boss trophy item');
  const trophy = rows.reward.trophy;
  const buildFinish = (id: string): THREE.Object3D => {
    const skin = HeldFinishes.current(source.identity.slug).get(id), model = skin.weapon === slots.firearm.slot ? rifle.displayModel() : launcher.displayModel();
    applySkin(model, skin, sky); return model;
  };
  const parked = new Map<string, THREE.Object3D>(), park = new THREE.Group(); park.name = rows.parked.name; park.position.y = rows.parked.y; game.scene.add(park);
  for (const id of rows.parked.finishes) { const model = buildFinish(id); model.visible = false; park.add(model); parked.set(id, model); }
  const finishModel = (id: string): THREE.Object3D => {
    const model = parked.get(id); if (model === undefined) return buildFinish(id);
    parked.delete(id); model.removeFromParent(); model.visible = true; return model;
  };
  const tells = Array.from({ length: rows.tells.count }, () => context.scope.run(() => eliteGroundTell(game.scene, 'lane', new THREE.Color(...rows.tells.colour))));
  installEnteredRuntimeService(context, scope => { scope.onDispose(() => { for (const tell of tells) tell.hide(); }); });
  const condition = (rule: EliteRule): boolean => rule === 'always' || (rule === 'dusk' ? ctx.dusk() > rows.availability : rule === 'night' ? ctx.night() > rows.availability : false);
  const persistence = bindAdventurePersistence(context, source, await context.product.json(rows.persistence), source.identity.slug);
  const eliteUi = context.scope.run(() => new EliteBar()), elites = context.scope.run(() => new Elites({ scene: game.scene, camera: game.camera, renderer: game.renderer, player, condition,
    ownSkin: id => { if (HeldFinishes.current(source.identity.slug).has(id)) ctx.ownSkin(id); },
    canSee: (from, to) => context.app.physics === null || lineOfSight(context.app.physics, from, to, .6),
  }, eliteUi, source.identity.slug, persistence.elites));
  const eliteRows = await readPageEliteRows(context.product, rows.elites);
  const eliteFeature = context.scope.run(() => installEliteFeaturePage(game, animals, player, elites, parked, eliteRows, play.hud));
  elites.bindEnteredPresentation({ scope: context.scope, interactables: runtime.interactables, hud: play.hud, audio, music }, rows.elitePresentation);
  const fight = await installRoamingBossProjection(context, rows.projection);
  const night = (): boolean => ctx.night() > rows.availability;
  const encounter = context.scope.run(() => installBossEncounter(bossEncounterPresentation(rows.presentation, rows.projection.encounter), () => fight, {
    game, player, row: rows.projection.encounter.steps.fight, scope: context.scope, chunkId: source.identity.slug, interactables: runtime.interactables, persistence: persistence.bosses,
    reward: { model: () => { const group = new THREE.Group(), model = bow.displayModel(); model.rotation.x = rows.reward.bowPitch; model.scale.setScalar(rows.reward.bowScale); group.add(model); return group; },
      grant: () => { ctx.ownSkin(rows.reward.finish); loadout.grantLongbow(); }, trophy: () => { ctx.addItem(trophy, rows.reward.count); } },
    lockInput: on => { session.lockInput(on); }, respawn: (position, yaw) => { player.spawn(position.x, position.z, yaw); player.pitch = 0; loadout.onPlayerDeath(); launcher.addBolts(slots.pouch.capacity - launcher.state.bolts); },
    skipHeld: () => context.app.input.held('skip') || context.app.input.held('jump') || context.app.input.held('use') || context.app.input.held('confirm'),
    toast: ctx.toast, feed: ctx.feed, pickupHum: on => { audio.pickupHum(on); },
    score: () => CatalogueScore.get(music, requireAudioProfile(source.audio.music, rows.score), undefined, false), ambientScene: () => night() ? rows.nightScene : rows.dayScene,
  }));
  if (retainsRuntimeServices(context)) {
    installEnteredRuntimeAttachment(context, eliteUi.root); installEnteredRuntimeAttachment(context, encounter.ui.root);
    installEnteredRuntimeService(context, scope => { eliteUi.setActive(true); scope.onDispose(() => { eliteUi.setActive(false); }); });
    elites.initialize();
  }
  context.answer('weather.hold', previous => context.app.render === game ? Math.max(previous, fight.room.sealK) : previous);
  context.system({ id: rows.system.id, phase: 'update', before: rows.system.before, run: (dt, time) => {
    session.legs(); let n = 0;
    for (const actor of animals.animals) {
      if (n >= tells.length) break;
      // the flags first: only a charging animal is measured (FC16: the distance of every animal, ~170 at Pine, each frame)
      if (!actor.alive || actor.hidden || !actor.aggressive || actor.state !== 'charge') continue;
      const d = Math.hypot(game.camera.position.x - actor.position.x, game.camera.position.z - actor.position.z);
      if (d > rows.tells.range || d < rows.tells.near) continue;
      const tell = tells[n++]; if (tell === undefined) break;
      const length = d + rows.tells.ahead; tell.setTime(time);
      tell.lane(actor.position.x, actor.position.z, actor.position.x + Math.sin(actor.yaw) * length, actor.position.z + Math.cos(actor.yaw) * length,
        rows.tells.width * Math.max(1, actor.scale * rows.tells.scale), rows.tells.alpha + rows.tells.pulse * Math.sin(time * rows.tells.frequency));
    }
    for (let i = n; i < tells.length; i++) tells[i]?.hide();
    if (!perfLap.active) { eliteFeature.update(dt, time); encounter.update(dt, time); }
  } });
  installEnteredRuntimeService(context, scope => { scope.onDispose(() => { session.onPlayerDeath(); player.carried = false; }); });
  installEnteredRuntimeObserver(context, rows.observers.elites, eliteFeature); installEnteredRuntimeObserver(context, rows.observers.boss, encounter);
  context.scope.onDispose(() => { park.removeFromParent(); });
  return { elites, encounter, finishModel, weatherHold: () => fight.room.sealK, onPlayerDeath: () => { session.onPlayerDeath(); return encounter.onPlayerDeath(); },
    isElite: (actor: Animal) => eliteFeature.isElite(actor), useSfx: (bank: DeclaredSoundBank) => { session.useSfx(bank); }, eliteEngaged: () => elites.focus?.state === 'engaged' };
}

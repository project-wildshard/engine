
import type { SwimArms } from '@wildshard/engine/player/Hands';
import type { EnteredEquipment as DeclarationEnteredEquipment } from '../grid/enteredEquipment';
import type { World } from '@wildshard/engine/core/bootstrap';
import type { ShardManifest, FieldModelsContext } from '../shard/manifest';
import type { Game } from '@wildshard/engine/core/Game';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import type { Player } from '@wildshard/engine/player/Player';
import type { Forest } from '@wildshard/engine/world/forest/Forest';
import type { WorldRegistry } from '@wildshard/engine/world/registry';
import type { Vector3 } from 'three';
import type { Boundary } from '@wildshard/engine/world/Boundary';
import type { Water } from '@wildshard/engine/world/pond';
import type { Horizon } from '@wildshard/engine/world/Horizon';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { Audio } from '@wildshard/engine/audio/Audio';
import type { Music } from '@wildshard/engine/audio/Music';
import type { LevelContext } from '@wildshard/engine/level/context';
import type { Loading } from '@wildshard/engine/ui/Loading';
import type { LevelAudioProfile } from '@wildshard/engine/audio/levelAudio';

import type { Preload, AudioBanks } from '@wildshard/engine/boot/extras';

import type { LoadStage } from '../shard/load';
import type { StagedBoot, SessionState, KitPorts } from './context';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { bindEquipmentActors } from '../loadout/actors';
import type { Targets } from '@wildshard/engine/combat/types';
import type { Weapon } from '@wildshard/engine/combat/Weapon';
import { weaponInputContext } from '@wildshard/engine/input/gameplay';
import type { TrainingArena as Arena } from '@wildshard/engine/practice/TrainingArena';
import { loadPractice } from '@wildshard/engine/boot/runtime';
import type { DiscSpot } from '@wildshard/engine/ui/hudSlots';
import { GAME_STRINGS } from '../../../shared/game/strings';
import { titleCards } from '../titleDeck';
import { buildTitleMenu } from '../mainMenu';
import { pageMode } from '../plugin/context';
import { enterGrid } from '../grid/pageEntry';
import { travel } from '../travel/travel';
import type { worldStage } from './world';
import { withOwner } from '@wildshard/engine/app/ownership';
import { app } from '@wildshard/engine/app/runtime';
import { macrotask, type Plan, type StepRunner } from '@wildshard/engine/boot/plan';
import { EquipmentService } from '@wildshard/engine/combat/EquipmentService';
import { authoredTargets } from '@wildshard/engine/combat/targets';
import { viewmodelTexturesReady } from '@wildshard/engine/combat/view/ranged';
import { AnimalHerdView } from '@wildshard/engine/entities/AnimalHerdView';
import { RowBodies } from '@wildshard/engine/entities/RowBodies';
import { listShardModels } from '@wildshard/engine/models/roster';
import { LockOnSystem } from '@wildshard/engine/player/LockOnTarget';
import { TouchControls } from '@wildshard/engine/player/TouchControls';
import { HUD } from '@wildshard/engine/ui/HUD';
import { setting } from '@wildshard/engine/ui/Settings';
import type { MusicStyle } from '@wildshard/engine/audio/bootAudio';
import { hudAdapters } from '@wildshard/engine/ui/hudAdapters';
import { bindClockSettings } from './clockSettings';

async function buildLoadout(ctx: Awaited<ReturnType<typeof worldStage>>) : Promise<{ animals: RowBodies; getArena: () => Arena | null; prepareArena: () => Promise<Arena>; swimArms: SwimArms | undefined; crossbow: Weapon; rifle: Weapon | null; longbow: Weapon | null; weapons: EquipmentService; enteredEquipment: DeclarationEnteredEquipment | undefined; lockSys: LockOnSystem; touchControls: TouchControls; hud: HUD; world: World & { chunk: ShardManifest; }; game: Game; sky: SkyRig; player: Player; forest: Forest; params: URLSearchParams; chunk: ShardManifest; registry: WorldRegistry; fragileBoot: boolean; failGpuBoot: (reason: string, stack?: string) => void; onBootContextLost: (event: Event) => void; nolock: boolean; viewer: () => Vector3; edgeDressing: { boundary: Boundary; water: Water | null; streams: null; horizon: Horizon; horizonReady: Promise<void>; }; boundary: Boundary; water: Water | null; horizon: Horizon; interactables: Interactable[]; props: null; prepareAudio: () => { audio: Audio; music: Music; }; disableBootGpuGuard: () => void; level: LevelContext | undefined; loading: Loading; audioProfile: LevelAudioProfile | undefined; files: Readonly<Record<"sky" | "baked" | "terrain" | "trees" | "physics" | "cabins" | "props" | "art" | "music" | "sfx", readonly string[]>>; plan: Plan<"audio" | "sky" | "terrain" | "physics" | "cabins" | "props" | "renderer" | "cards" | "forest" | "edge" | "grass" | "animals" | "weapon" | "assembly" | "menu" | "shaders" | "firstFrame">; step: StepRunner; menuLoad: Preload<void> | null; audioLoad: Preload<AudioBanks> | null; deferredAudio: (Preload<void> & { readonly style: MusicStyle; decode: () => Promise<AudioBanks>; }) | null; fieldModels: Promise<(ctx: FieldModelsContext) => void> | null; manifest: ShardManifest; slug: string; stage: LoadStage; boot: StagedBoot; session: SessionState; kit: KitPorts; product: ShardFolder; }> {
  const { kit, stage, boot, step, fieldModels, world, game, sky, player, forest, chunk, registry, nolock, product } = ctx;


  const animals = await step('animals', async (p) => {
    const a = await new RowBodies(new AnimalHerdView(game.rootScene, sky), app).build(macrotask); // a task per species, not one long one
    p.detail(`${a.animals.length} animals`);
    return a;
  });
  boot.runtime.hooks.animalsReady?.(animals);
  await boot.runtime.hooks.animalsBuilt?.(animals);
  // the shard's models, for Explore World's catalog and tap-to-select (src/client/engine/explore/registry.ts: a shard registers what it built);
  // Driftwood's are on the model contract (E315 M1: `place` registers them)
  // the core fields' copies drawn as the shard's models (ShardManifest.fieldModels, E349: Pine Hollow's trees and forest-floor kinds, E315 M2)
  if (fieldModels) await stage('fieldModels', async () => { (await fieldModels)({ sky, renderer: game.renderer, forest, under: null, registry }); });
  const roster = await stage('roster', async () => {
    const native = await chunk.roster?.(product) ?? [];
    return product.has('explore/catalogue') ? (await import('../models/explorerCatalogue')).explorerRoster(product, native) : native;
  });
  await stage('roster', () => listShardModels({ roster: () => Promise.resolve(roster), style: game.level.creatureStyle ?? 'pbr', sky, renderer: game.renderer, animals: () => animals.animals, registry })); // every shard's live models in its Model Explorer (E315 M5): the shared training dummy, its creatures (its species list, alive now or not), people and gear
  const dayNight = sky.dayNight; // the backdrop's shared clock drives night activity
  if (dayNight) animals.enemyWorld.night = () => dayNight.night;
  // The resident clock drives Settings, Explore light presets and the HUD day badge.
  const worldClock = dayNight ?? app.dayCycle;
  app.registerDayCycle(worldClock, game.levelScope);
  if (worldClock) bindClockSettings(worldClock, game.levelScope); // pause menu ▸ Settings ▸ Time of day (E55)

  // ── player kit: the shard's weapon + the rifle slot where the shard has one (EquipmentService.ts: 1…N / Q, the touch SWAP ring), HUD, audio ──
  const shardSword = (await step('weapon', () => Promise.all([viewmodelTexturesReady(), chunk.sword?.() ?? null])))[1]; // the viewmodels' textures from the worker + the lever-action's model (usually long done) + the shard's own sword (ShardManifest.sword); the build below is synchronous
  let arena: Arena | null = null;
  // contact leaves the client when a server owns the player: it settles each blow and its `hit` plays it (J47)
  const targets: Targets = authoredTargets(app.events, { raycast: (origin, dir, maxDist) => player.link === null ? animals.raycast(origin, dir, maxDist) : null }, () => arena?.entered === true ? arena : null);
  bindEquipmentActors(targets,animals,game.levelScope);
  const swimArms = shardSword?.swim;
  const authoredKit = await boot.runtime.buildEquipment?.(targets, nolock, shardSword);
  if (authoredKit === undefined) throw new Error('Shard has no primary equipment factory');
  const crossbow: Weapon = authoredKit.primary;
  await macrotask(); // each viewmodel in its own task
  // the rifle slot: Pine Hollow's lever-action (PH-U5, LeverRifle.ts — the crossbow's walnut, shared), the AR-15 on Nalati
  // (the practice room's loan); none on the sword shards, Driftwood and Nine Dragon (E333, Jake: "why is there an AR-15 in Driftwood?")
  const rifle = authoredKit.rifle ?? null;
  await macrotask();
  const longbow = authoredKit.secondary ?? null;
  const roadEquipment: EquipmentService = new EquipmentService(crossbow, { scope: game.levelScope, events: app.events,
    ...(ctx.session.ownedGridHome === true ? {} : { input: {
      bind: (action, run, scope, allowed) => { app.input.bind(action, run, scope, allowed ?? (() => roadEquipment.current.enabled)); },
    } } satisfies NonNullable<ConstructorParameters<typeof EquipmentService>[1]>),
    ...(authoredKit.order === undefined ? {} : { order: [...authoredKit.order] }) });
  const enteredEquipment = ctx.session.ownedGridHome === true ? await (async () => {
    const { EnteredEquipment } = await import('../grid/enteredEquipment');
    if (game.levelScope.disposed || game.levelScope.disposing) throw new Error('Grid owner retired while loading equipment');
    return new EnteredEquipment(roadEquipment);
  })() : undefined;
  const weapons = enteredEquipment?.service ?? roadEquipment;
  for (const w of [...(rifle ? [rifle] : []), ...(authoredKit.extras ?? []), ...(longbow ? [longbow] : [])]) weapons.add(w, { locked: true });
  weaponInputContext(weapons, game.levelScope);
  for (const id of game.level.loadout.tools) {
    const row = kit.tools.find((tool) => tool.id === id);
    if (row !== undefined) weapons.add(row.create(game.camera, player), { locked: !game.level.loadout.start.includes(id) });
  }
  app.registerEquipment(weapons, game.levelScope);
  const lockSys = new LockOnSystem(player, weapons, game.camera); // the Zelda lock-on (E50): LOCK / Z, orbit, flick-switch — src/client/engine/player/LockOnTarget.ts
  const touchControls = new TouchControls(player, weapons, setting('touch') === 'on', lockSys); // on-screen FPS controls on coarse-pointer devices (?touch=1 / main menu ▸ Settings ▸ Touch controls forces)
  authoredKit.install?.(weapons);
  await weapons.settleSelection();
  await macrotask();
  const hud = withOwner(game.engineScope, () => new HUD({ pointerLock: !nolock, weaponUi: weapons.current.row.ui, maxBolts: weapons.state.magazine, ...(chunk.status === 'hidden' ? { developerBanner: GAME_STRINGS.developer.banner(chunk.slug.replace(/^_/, '')) } : {}) }));
  // the title deck (E318): this level's card enters or explores here, another's opens in a fresh page (travel)
  hud.titleDeck = (here) => {
    const cards = titleCards(), own = cards[cards.map((card): string => card.slug).indexOf(chunk.slug)];
    return buildTitleMenu({
      cards, active: chunk.slug,
      // this card enters here; another card is a fresh page
      onEnter: (c) => { if (c === own) here.enter(); else travel({ to: c.slug, mode: 'enter' }); },
      onExplore: (c) => { if (c !== own) { travel({ to: c.slug, mode: 'explore' }); return; } here.explore(); },
      onGrid: () => { if (pageMode() === 'grid') here.enter(); else enterGrid(); }, // SF21a: the main menu's second entry
      onSettings: here.settings,
    });
  };
  const shellHud = new Set(document.querySelectorAll('#hud *'));
  game.hudBaseline = shellHud.size;
  game.hudRetained = shellHud;
  let practiceReady: Promise<Arena> | null = null;
  const readArena = async (): Promise<Arena> => {
    const { TrainingArena } = await loadPractice();
    if (game.levelScope.disposed) throw new Error('Practice owner retired while loading code');
    arena = withOwner(game.levelScope, () => new TrainingArena(game, registry, world.physics, { x: chunk.spawn.x, z: chunk.spawn.z }));
    return arena;
  };
  const prepareArena = async (): Promise<Arena> => {
    const pending = practiceReady ??= readArena();
    try { return await pending; }
    catch (error) { practiceReady = null; throw error; }
  };
  const getArena = (): Arena | null => arena;
  // E307: the open feature playground (src/playgrounds/: Nine Dragon's grapple course, Nalati's horse track), entered from the
  // Explore hub like the arena. `away()`: the player is in a practice room, not the shard (no bounds, no map, no last place)

  lockSys.inputService = app.input;
  app.addSystem({ id: 'engine.lockon.input', phase: 'input', after: ['engine.input.collect'], before: ['engine.player.input'], run: () => {
    if (app.input.consume('lock')) lockSys.resolveToggle();
  } }, game.levelScope);
  app.registerEquipmentHost({ game, player, viewmodel: game.viewmodel, physics: world.physics, arms: shardSword?.arms ?? null, lock: lockSys,
    toast: (message) => hud.toast(message), enabled: () => hud.entered && !world.freeCamera && !world.tour.active }, game.levelScope);
  const hudRoot = document.getElementById('hud');
  if (hudRoot === null) throw new Error('HUD root is missing');
  app.levelAdapters.hud = hudAdapters(game, game.levelScope, hudRoot, (spot, hint) => touchControls.relabel(spot, hint));
  const contextLabels = new Map<DiscSpot, () => void>();
  app.input.touchSink((labels) => {
    for (const dispose of contextLabels.values()) dispose(); contextLabels.clear();
    for (const [spot, hint] of Object.entries(labels)) {
      contextLabels.set(spot as DiscSpot,
        app.levelAdapters.hud?.relabel(spot as DiscSpot, hint.label, hint.icon ?? '', hint) ?? (() => undefined));
    }
  }, game.levelScope);
  return { ...ctx, animals, getArena, prepareArena, swimArms, crossbow, rifle, longbow, weapons, enteredEquipment, lockSys, touchControls, hud };
}

export const loadoutStage: typeof buildLoadout = buildLoadout;

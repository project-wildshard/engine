
import { readOnlySave, wirePage } from '../shardfile/wirePage';
import { ownedSave } from '../../../shared/game/saves';
import type { GridSession as DeclarationGridSession } from '../grid/session';
import { exitSessionToTitle } from './exitToTitle';
import { initialHomeMetadataRequired } from '../grid/homeMetadata';
import { timeClientPreparation } from '../shardfile/preparationTiming';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { Audio } from '@wildshard/engine/audio/Audio';
import type { Music } from '@wildshard/engine/audio/Music';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { TitleArrival } from '@wildshard/engine/boot/titleArrival';
import type { TrainingArena } from '@wildshard/engine/practice/TrainingArena';

import type { Weapon } from '@wildshard/engine/combat/Weapon';
import type { EquipmentService } from '@wildshard/engine/combat/EquipmentService';
import type { EnteredEquipment } from '../grid/enteredEquipment';
import type { LockOnSystem } from '@wildshard/engine/player/LockOnTarget';
import type { TouchControls } from '@wildshard/engine/player/TouchControls';
import type { HUD } from '@wildshard/engine/ui/HUD';
import type { World } from '@wildshard/engine/core/bootstrap';
import type { ShardManifest, FieldModelsContext } from '../shard/manifest';
import type { Game } from '@wildshard/engine/core/Game';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import type { Player } from '@wildshard/engine/player/Player';
import type { Forest } from '@wildshard/engine/world/forest/Forest';
import type { WorldRegistry } from '@wildshard/engine/world/registry';
import type { Boundary } from '@wildshard/engine/world/Boundary';
import type { Water } from '@wildshard/engine/world/pond';
import type { Horizon } from '@wildshard/engine/world/Horizon';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { LevelContext } from '@wildshard/engine/level/context';
import type { Loading } from '@wildshard/engine/ui/Loading';
import type { LevelAudioProfile } from '@wildshard/engine/audio/levelAudio';



import type { LoadStage } from '../shard/load';
import type { StagedBoot, SessionState, KitPorts } from './context';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { resolveLevelBounds } from '../../../shared/game/shard/runtime';
import { SkinLocker } from '../cosmetics/locker';
import { BagMenu } from '../bag/tabs';
import { equipmentEntry, toolEntries } from '../bag/equipment';
import type { WeaponId } from '@wildshard/engine/combat/Equipment';
import type { DeathCause } from '@wildshard/engine/combat/pipeline';
import { type Bucket, frameCost } from '@wildshard/engine/core/frameCost';
import { heldFrameTurn } from '@wildshard/engine/core/framePacing';
import type { Explore, ExploreMode } from '@wildshard/engine/explore/Explore';
import { type AimTarget, meleeLock, setAimTargets } from '@wildshard/engine/player/AimTargets';
import { type SkinDef, applySkin } from '@wildshard/engine/player/Skins';
import type { PlaygroundId } from '@wildshard/engine/practice/playground/catalog';
import type { Playground } from '@wildshard/engine/practice/playground/Playground';
import type { Feedback } from '@wildshard/engine/ui/Feedback';
import { installBodyShadow } from '../cosmetics/bodyShadow';
import { isOwnedId, Owned } from '../../../shared/game/loot/Owned';
import { bindTravelInventory, applyTravelCarry } from '../travel/travel';
import * as THREE from 'three';
import { BagButton } from '../bag/BagButton';
import { Progress } from '../Progress';
import { Inventory, type ItemId } from '../Inventory';
import { legacyHomeCheckpoint } from '../grid/homeCheckpoint';
import { initialGridReload, plannedGridReload } from '../../../shared/game/grid/recovery';
import { ITEMS, isItemId } from '../../../shared/game/bag/itemCatalog';
import { LastPlace, placeName } from '@wildshard/engine/quest/lastPlace';
import { shardCompleteUp } from '../complete/ShardComplete';
import type { loadoutStage } from './loadout';
import { animalPositions } from './positions';
import { describeKeyBindings } from '../keyBindings';
import { app } from '@wildshard/engine/app/runtime';
import { beginExploreEntry, recordBootCheckpoint } from '@wildshard/engine/boot/bootTrace';
import { startMenuPreload, type Preload, type AudioBanks } from '@wildshard/engine/boot/extras';
import { macrotask, type Plan, type StepRunner } from '@wildshard/engine/boot/plan';
import { waitFor } from '@wildshard/engine/boot/waits';
import { loadExplore, loadFeedback as loadFeedbackModule, loadPlayground } from '@wildshard/engine/boot/runtime';
import { CombatCues } from '@wildshard/engine/combat/cues';
import { EffectService } from '@wildshard/engine/combat/effects/EffectService';
import { PlayerHealth } from '@wildshard/engine/combat/health';
import { KeepAlive } from '@wildshard/engine/core/KeepAlive';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { isDev } from '@wildshard/engine/core/devMode';
import { tap } from '@wildshard/engine/core/harnessTap';
import { practiceRoom } from '@wildshard/engine/core/practiceRoom';
import { TIER } from '@wildshard/engine/core/tier';
import { Impacts } from '@wildshard/engine/fx/Impacts';
import { floorBelow, lineOfSight } from '@wildshard/engine/physics/query';
import { CameraFX } from '@wildshard/engine/player/CameraFX';
import { Hands, type SwimArms } from '@wildshard/engine/player/Hands';
import { Combat, aimReadout } from '@wildshard/engine/ui/Combat';
import { DeathFade } from '@wildshard/engine/ui/DeathFade';
import { FirstHints } from '@wildshard/engine/ui/FirstHints';
import { HurtArc, deathCause, respawnWhere } from '@wildshard/engine/ui/HurtArc';
import { LockOn } from '@wildshard/engine/ui/LockOn';
import { FullMap } from '@wildshard/engine/ui/Map';
import { GameMenu } from '@wildshard/engine/ui/Menu';
import { Minimap } from '@wildshard/engine/ui/Minimap';
import { Perf } from '@wildshard/engine/ui/Perf';
import { rotateGated } from '@wildshard/engine/ui/RotateGate';
import { getNumber, onNumber, type getMusicStyle } from '@wildshard/engine/ui/Settings';
import { SpeedLines } from '@wildshard/engine/ui/SpeedLines';
import { WeaponStrip } from '@wildshard/engine/ui/WeaponStrip';
import { WindupWarn } from '@wildshard/engine/ui/WindupWarn';
import { HAPTIC, buzz } from '@wildshard/engine/ui/haptics';
import { hudSlots } from '@wildshard/engine/ui/hudSlots';
import { installPlayerDeath } from '@wildshard/engine/ui/playerDeath';
import { PlayerHurt } from '@wildshard/engine/ui/playerHurt';
import { onReview, queuedCount, quickNote } from '@wildshard/engine/ui/review';
import { installBounds } from '@wildshard/engine/world/bounds';
import { gridCells, gridHomeSim, pageMode } from '../plugin/context';
import type { RowBodies } from '@wildshard/engine/entities/RowBodies';
import { whenControl } from '@wildshard/engine/boot/prefetch';
import { installMemoryWarning, residentOverLimit } from '../grid/memoryWarning';
import { installFirstPlay } from '../firstPlay';
import { registerGraphicsSettings } from '@wildshard/engine/ui/graphicsBlock';
import { ACCENTS } from '@wildshard/format/accent';
import { installShardHoverSpeed } from '../../../shared/game/grid/rules';
import { findShard } from '../shard/registry';
import { accentHex, hudAccent, onHudAccent, setHudAccent } from './hudAccent';
import { firstPartyInstance } from '../../../shared/game/grid/instances';
import { installSavesSettings } from '../savesSettings';
import type { LiveGridSession } from '../grid/liveSession';
import { pickInteractable } from '@wildshard/engine/world/interact/Interactables';
import { terrainDatum } from '@wildshard/engine/world/terrainHeight';
import { createViewProgramKeeper } from '@wildshard/engine/render/programRetention';

/** T10: the grid page's background waits for this much drawn play after control at spawn (ms)… */
const GRID_SPAWN_SETTLE_MS = 3000;
/** …or for the player to move this far from where control began (m): a walk or a ride opens it at once */
const GRID_SPAWN_SETTLE_METRES = 2;

async function buildPlay(ctx: Awaited<ReturnType<typeof loadoutStage>>) : Promise<{ grid: DeclarationGridSession | null; gridLive: LiveGridSession | null; leakPhysics: Physics; perf: Perf; audio: Audio; music: Music; playerHealth: PlayerHealth; serverHurt: (amount: number, at: THREE.Vector3, blow: boolean) => void; serverDied: (event: { checkpoint: boolean; cause?: DeathCause }, resume: () => void) => void; exploring: () => boolean; hands: Hands; windupWarn: WindupWarn<Animal> | null; resuming: boolean; continuingGridEntry: boolean; arrival: TitleArrival | null; menuFirst: boolean; enter: () => void; getPlayground: () => Playground | null; minimap: Minimap; startExplore: (() => void) | undefined; animals: RowBodies; getArena: () => TrainingArena | null; prepareArena: () => Promise<TrainingArena>; swimArms: SwimArms | undefined; crossbow: Weapon; rifle: Weapon | null; longbow: Weapon | null; weapons: EquipmentService; enteredEquipment: EnteredEquipment | undefined; lockSys: LockOnSystem; touchControls: TouchControls; hud: HUD; world: World & { chunk: ShardManifest; }; game: Game; sky: SkyRig; player: Player; forest: Forest; params: URLSearchParams; chunk: ShardManifest; registry: WorldRegistry; fragileBoot: boolean; failGpuBoot: (reason: string, stack?: string) => void; onBootContextLost: (event: Event) => void; nolock: boolean; viewer: () => THREE.Vector3; edgeDressing: { boundary: Boundary; water: Water | null; streams: null; horizon: Horizon; horizonReady: Promise<void>; }; boundary: Boundary; water: Water | null; horizon: Horizon; interactables: Interactable[]; props: null; prepareAudio: () => { audio: Audio; music: Music; }; disableBootGpuGuard: () => void; level: LevelContext | undefined; loading: Loading; audioProfile: LevelAudioProfile | undefined; files: Readonly<Record<"sky" | "baked" | "terrain" | "trees" | "physics" | "cabins" | "props" | "art" | "music" | "sfx", readonly string[]>>; plan: Plan<"audio" | "sky" | "terrain" | "physics" | "cabins" | "props" | "renderer" | "cards" | "forest" | "edge" | "grass" | "animals" | "weapon" | "assembly" | "menu" | "shaders" | "firstFrame">; step: StepRunner; menuLoad: Preload<void> | null; audioLoad: Preload<AudioBanks> | null; deferredAudio: (Preload<void> & { readonly style: ReturnType<typeof getMusicStyle>; decode: () => Promise<AudioBanks>; }) | null; fieldModels: Promise<(ctx: FieldModelsContext) => void> | null; manifest: ShardManifest; slug: string; stage: LoadStage; boot: StagedBoot; session: SessionState; kit: KitPorts; product: ShardProduct; }> {
  const { manifest, boot, session, kit, files, step, menuLoad, world, game, sky, player, params, chunk, registry, nolock, viewer, boundary, horizon, prepareAudio, animals, getArena, prepareArena, swimArms, crossbow, rifle, longbow, weapons, lockSys, touchControls, hud } = ctx;
  const leakPhysics = world.physics; // The borrowed page world outlives temporary active frames.
  // G628 M4: a shard page's Developer warning chip; a grid page's resident over-limit is a line of its memory strip instead,
  // and a neighbour's cold estimate shows nowhere (the G217 blocked cell screen reads the policy, not the chip)
  if (session.memory !== undefined && pageMode() !== 'grid') installMemoryWarning(session.memory, game.levelScope, manifest.slug);
  installFirstPlay(game.levelScope, hud.root, manifest.slug); // MOBILE-GRAPHICS MG5: the title's first play, once the player has control
  game.levelScope.onDispose(registerGraphicsSettings()); // MOBILE-GRAPHICS MG8: the phone's Graphics controls in Settings ▸ Graphics

  let playground: Playground | null = null;
  const away = (): boolean => getArena()?.entered === true || playground?.entered === true;
  const weaponStrip = new WeaponStrip(weapons); // every shard's one swap control (E303 / E319): the SWAP ring + pie on touch, a hotbar on desktop
  const lockOn = new LockOn(game.camera); // sword lunge target brackets (meleeLock, Sword.ts)
  const speedLines = new SpeedLines(); // dodge / lunge edge streaks
  const perf = new Perf(game); // frame meter top-right (?perf=0 hides)
  const minimap = new Minimap(); // circular minimap (Heightfield is installed by now)
  if (chunk.hud?.dayBadge === true) minimap.showDayBadge(); // the sun / moon on its rim (Nalati)
  const fullMap = new FullMap(minimap); // the menu's MAP tab (Menu.ts mounts it); tap the minimap / M to open
  const keepAlive = new KeepAlive();
  let gridBackgroundReady = false;
  let gridControlReady = false;
  let viewPrograms: ReturnType<typeof createViewProgramKeeper> | undefined;
  await macrotask();
  // SF21a / the grid client: EXPERIMENTAL Wildshard's 3 × 3 around this home cell (deck, soft walls, neighbours' far proxies)
  const grid = await step('assembly', async p => {
    if (pageMode() !== 'grid') return null;
    const { GridSession } = await timeClientPreparation('grid', 'assembly.module', () => waitFor('Read grid session module', import('../grid/session'), 'file'));
    if (game.levelScope.disposed) throw new Error('Grid owner retired while loading its session');
    return GridSession.create({ scene: game.rootScene, physics: world.physics, scope: game.levelScope, feet: () => player.position, renderer: game.renderer,
    // Two nearby road tiles remain live 3D around the waiting screen. Only the
    // normal frame is bounded; preparation retains its complete scene/camera.
    heldFrame: game.bindFrameDrawRange(game.levelScope, 125),
    backgroundReady: () => hud.entered && gridBackgroundReady,
    // G371: the near tier plans from the drawn eye (a free / hero camera gets the cells it is over)
    eye: () => ({ x: game.camera.position.x - player.position.x, z: game.camera.position.z - player.position.z }),
    prepareTile: (tile) => game.warmSceneRoots([tile.group], () => !tile.scope.disposed),
    prepareView: (root, current) => game.warmSceneRoots([root], () => !game.levelScope.disposed && current()),
    prepareViews: (roots, current) => game.warmSceneRoots(roots, () => !game.levelScope.disposed && current()),
    keepViewPrograms: (view) => {
      try { (viewPrograms ??= createViewProgramKeeper(game.renderer, game.levelScope, game.camera, game.rootScene))(view); }
      catch (error: unknown) { console.warn('[grid] view programs not kept', error); }
    },
    prepareSkyLayers: () => game.warmSkyLayers(),
    ...(ctx.session.residency === undefined ? {} : { residency: ctx.session.residency }),
    onFixed: (fn) => { game.onFixed('post', fn, 'game.grid.session'); },
    frame: { prepareDisplay: pass => game.preparePostPass(pass), scene: game.rootScene, camera: game.camera, composer: () => game.composer, post: () => game.post, sunDir: () => game.sky.sunDir, cinematic: () => game.regionCinematic(), slices: () => game.depthSlices,
      // G321: the frame blends the camera's field of view by owner; the shadow cascades follow it
      refit: () => { game.sky.csm.updateFrustums(); },
      // G343: an eye lifted far above the player (a free camera) hands the horizon back to the grid
      lift: () => game.camera.position.y - player.position.y,
      // G242: the road's dome and key light are a base layer on the page's sky rig (game.sky throws until it is built)
      sky: () => { const rig = game.sky; return { layerBackdrop: (o) => rig.layerBackdrop(o), warm: (object) => {
        // into the composer's input buffer, as the dome is drawn: the canvas target would be a second program variant
        const renderer = game.renderer, prev = renderer.getRenderTarget();
        renderer.setRenderTarget(game.composer.inputBuffer);
        try { renderer.compile(object, game.camera, game.rootScene); } finally { renderer.setRenderTarget(prev); }
      } }; },
      onLate: (fn) => { game.onLate(fn, 'game.grid.frame'); } } }, p, initialHomeMetadataRequired(session));
  });
  // This home is already the real control dependency, not a neighbour or a
  // recovery-road guess. Metadata can overlap UI; construction stays in finish.
  if (grid !== null && initialHomeMetadataRequired(session)) grid.startInitialHomeMetadata();
  if (grid === null) installShardHoverSpeed(player, game.levelScope, manifest.hoverSpeedClass);
  await step('menu', async (p) => { // the cards' art in memory before the title builds its deck (showIntro below)
    // + the practice room's dummies when this boot lands in it (a travel in arena mode): full on its first frame (E291). Any
    // other boot loads them when the room opens, in every mode (G187: −33.6 MB of GL on Pine; SF47 made it the only path).
    const practice = isDev() && session.arrival?.mode === 'arena' ? prepareArena().then(room => room.preload()) : null;
    if (pageMode() !== 'grid') await (menuLoad ?? startMenuPreload(files, chunk)).wait(p); // the grid has no title deck (data.ts)
    await practice; // the grid's streaming is covered by its entry reveal (G98, below), not the loading screen
  });
  const { audio, music } = prepareAudio();
  const arrivalSpawn = boot.handoff?.arrive ?? chunk.spawn;
  let gridLive: LiveGridSession | null = null; // the grid's live crossing (attached below, once the player's health exists)
  const toSpawn = () => {
    const region = gridLive?.spawn() ?? null; // off the home frame: the active region's start, or the deck under the feet
    if (region !== null) { player.spawn(region.x, region.z, region.yaw, region.y); return; }
    player.spawn(arrivalSpawn.x, arrivalSpawn.z, arrivalSpawn.yaw, arrivalSpawn.y); if (!boot.handoff?.arrive) { const y = boot.runtime.hooks.spawnFloor?.(player.position.x, player.position.z); if (y !== undefined) player.position.y = y; }
  };
  const respawn = () => { toSpawn(); music.sting('death'); };
  // in the grid every frame has fall recovery (a level without authored bounds, Driftwood, gets the grid's fall floor; the horizontal check is the grid's)
  const GRID_FALL_FLOOR = -60;
  const authoredBounds = resolveLevelBounds(game.level.bounds, boot.runtime.hooks);
  const bounds = authoredBounds ?? (grid === null ? undefined : { x0: -Infinity, x1: Infinity, z0: -Infinity, z1: Infinity, floor: GRID_FALL_FLOOR });

  let kills = 0, swimHold = false;
  // SF28 (G87 / G104): the big item cards wear the shard's declared accent (in the grid, the cell's: grid/gridHud.ts)
  setHudAccent(accentHex(manifest.accent)); hud.cardAccent = hudAccent();
  game.levelScope.onDispose(onHudAccent((hex) => { hud.cardAccent = hex; }));
  const owned = new Owned(manifest.slug, readOnlySave(ownedSave));            // E314: upgrades, cosmetics, trophies, the found iron sword (src/shared/game/loot/Owned.ts)
  const playerHealth = new PlayerHealth(app.events, {
    now: () => performance.now(), position: () => player.position,
    dodging: () => player.dodging, dodgeGuard: () => false,
    mode: () => player.mountedOn !== null ? 'ride' : player.hover ? 'board' : player.swimming ? 'swim' : 'foot',
    impulse: (velocity) => player.impulse(velocity),
  });
  app.registerPlayer(playerHealth, game.levelScope);
  installBounds(app, game.levelScope, bounds, { player,
    toSpawn: () => { if (gridLive === null) toSpawn(); else app.combat.fall(playerHealth, player.position, { kind: 'out-of-world', label: '' }); },
    fallFloor: () => gridLive?.fallFloor() ?? bounds?.floor ?? GRID_FALL_FLOOR,
    floorAt: (x, z) => ((gridLive?.spawn() ?? null) === null ? registry.floorAt(x, z) : floorBelow(world.physics, x, z, player.position.y + 0.6, 1.2)),
    suspended: () => player.link !== null || world.freeCamera || world.tour.active || away() || (grid !== null && player.carried), grid: () => grid !== null, frame: () => gridLive?.frame() });
  // the grid client step 2: the live crossing (LiveGridHost + GridCrossing in the page's one fixed step; G68's safe zone)
  // The installed play owner confirms its progress and pack writes; source clients supply their own durable handoff.
  gridLive = grid?.attach({ traveller: player, health: playerHealth, equipment: weapons, events: app.events,
    runtimePage: () => boot.context === undefined || boot.runtime.play === null ? null : { world, play: boot.runtime.play, context: boot.context, ...(ctx.enteredEquipment === undefined ? {} : { equipment: ctx.enteredEquipment }) },
    onSafeZone: () => { app.effects?.clearHarmful(playerHealth); },
    saves: app.saves, ...(authoredBounds === undefined ? {} : { homeFallFloor: authoredBounds.floor }), checkpoint: legacyHomeCheckpoint(() => boot.runtime.play), catalogue: [],
    setPhysics: (physics) => { world.physics = physics; app.physics = physics; },
    onFixedPre: (fn) => { game.onFixed('pre', fn, 'game.grid.live.pre'); }, onFixedPost: (fn) => { game.onFixed('post', fn, 'game.grid.live.post'); },
    onInput: (fn) => { game.onInput(fn, 'game.grid.origin.restore'); }, onUpdate: (fn) => { game.onUpdate(fn, 'game.grid.origin'); } }) ?? null;
  const effects = new EffectService(app.levelRegistrations.list('effect'), game.levelScope, app.events);
  app.registerEffects(effects, game.levelScope);
  playerHealth.attributes.incomingCap = chunk.fight?.maxHitDamage ?? Infinity;
  app.combat.playerRules(game.levelScope, { target: playerHealth, bossGod: params.has('bossGod'), capExempt: chunk.fight?.capExempt ?? [] });
  const harvested = new Set<object>();
  // ── the in-game menu: MAP · INVENTORY · ACHIEVEMENTS · SETTINGS (src/client/engine/ui/Menu.ts) ──
  const progress = new Progress(manifest.slug);     // shard achievements → titles (src/shared/game/achievements.ts)
  const inventory = new Inventory(manifest.slug);   // the pack: harvest drops
  inventory.writes = false; wirePage.hold({ inventory, gear: owned }, game.levelScope);
  if (boot.featTotal !== undefined) progress.setFeatTotal(boot.featTotal);
  applyTravelCarry(boot.handoff, inventory);
  game.levelScope.onDispose(bindTravelInventory({ shard: chunk.slug, inventory, rows: boot.items }));
  const skins = new SkinLocker(chunk.slug, boot.skins, ctx.product.has('state/migrations') ? ctx.product.section('state/migrations').migrations : []);                          // legendary skins owned / worn (persisted; wired below)
  wirePage.hold({ shard: chunk.slug, finishes: skins }, game.levelScope);
  const menu = new GameMenu({
    levelName: chunk.name,
    fullMap,
    keys: { bag: 'inventory' }, // the game's Bag key opens its inventory tab
    settings: () => ({ weapons: new Set(weapons.available.map((w) => w.id)), melee: weapons.available.some((w) => w.row.ui.melee),
      tracers: weapons.available.some((w) => w.row.ui.tracers), huntersEye: weapons.available.some((w) => w.row.ui.huntersEye === true) }),
  });
  new BagMenu(menu, {
    ...(manifest.bag?.tabs === undefined ? {} : { tabs: manifest.bag.tabs }),
    levelName: chunk.name, progress, inventory,
    kit: () => weapons.available.map((w) => { const worn = skins.wearing(w.id); return equipmentEntry(w, weapons.current, worn ? ` · ${worn.name}` : ''); }),
    onEquip: (id) => weapons.select(id as WeaponId),
    tools: () => toolEntries(weapons.tools, (key) => app.levelRegistrations.findText(key) ?? key),
    icons: kit.bagIcons,
    ...boot.runtime.menu,
  });
  hud.menu = menu; // pause → Settings tab; the menu's CLOSE → hud.onResume
  // pause ▸ Settings ▸ SAVES (SF33b, G83): a card per shard save, NEW GAME's before → after sheet; HERE is the grid cell you stand in, else this shard's copy
  const homeInstance = ((): string => { try { return firstPartyInstance(manifest.slug); } catch { return manifest.slug; } })();
  installSavesSettings(menu, { scope: game.levelScope, grid: grid !== null, toTitle: () => { exitSessionToTitle(); },
    ...(gridLive === null ? {} : { beforeReset: (instance) => {
      const commit = gridLive.prepareNewGameRecovery(instance);
      return () => { commit(); game.hold = true; };
    } }),
    here: () => { const cell = gridCells.cell; return grid === null ? { id: homeInstance, shard: manifest.slug } : cell === null ? null : { id: cell.instance, shard: cell.slug }; } });
  describeKeyBindings(game.levelScope); // pause ▸ Settings ▸ Key bindings: the plain-named table (E357 J10)
  game.onUpdate((dt) => { if (session.ownedGridHome !== true && hud.entered && !menu.isOpen) progress.addPlay(dt); }, 'main.6'); // owned regional progress has its own entered clock
  fullMap.bindMinimap(() => { if (hud.entered) menu.open('map'); }); // in a practice room: its own map (E321)
  // E124: the BAG button squaring out the minimap's top-right corner (src/client/game/bag/BagButton.ts) — opens on GEAR (E314)
  new BagButton(minimap.root, () => { if (hud.entered) menu.openBag(); });
  // M / I / Esc are the menu's own keys (src/client/engine/ui/Menu.ts, gated by the HUD: E130)
  menu.onOpen = () => { if (document.pointerLockElement) document.exitPointerLock(); }; // the map wants a cursor; the lock comes back on close (onResume)

  // ── the review inbox (project/archive/2026-09-22-feedback-inbox.md): unlocked in Settings → REVIEW, then F8 (desktop), the ✎ disc under
  // PAUSE (touch) and Settings ▸ System ▸ Feedback (SR13). The composer (src/client/engine/ui/Feedback.ts) loads on first use; while its overlay is up
  // the world is frozen on the captured frame (frameGate) and the weapons / pointer lock are released.
  let feedbackHeld = false;
  let feedback: Promise<Feedback> | null = null;
  const touchUi = () => document.getElementById('hud')?.classList.contains('touch') === true;
  let explore: Explore | null = null; // Explore World (below) — while it is up, notes describe the viewer, not the player
  const exploring = (): boolean => explore?.active === true;
  const entry = 'shardfile'; // SF65 (G240): notes keep naming the way in; LD8 left one (the shardfile)
  const loadFeedback = (): Promise<Feedback> => { feedback ??= loadFeedbackModule().then(({ Feedback: F }) => new F({
    capture: () => game.captureFrame(1280),
    context: () => (explore?.active === true ? { shard: manifest.slug, entry, ...explore.context(), tier: TIER, fps: game.stats.fps, calls: game.lastFrame.calls, tris: game.lastFrame.triangles } : {
      shard: manifest.slug, entry, pos: [player.position.x, player.position.y, player.position.z].map((v) => Number(v.toFixed(2))),
      yaw: Number(player.yaw.toFixed(3)), pitch: Number(player.pitch.toFixed(3)), weapon: weapons.current.id, health: Math.round(playerHealth.attributes.health), kills,
      swimming: player.swimming, hover: player.hover, tier: TIER, fps: game.stats.fps, calls: game.lastFrame.calls, tris: game.lastFrame.triangles,
    }),
    hold: (on) => {
      if (explore?.active === true) { feedbackHeld = on; explore.hold(on); return; }
      feedbackHeld = on; hud.holdPause = on;
      if (on) { weapons.setEnabled(false); if (document.pointerLockElement) document.exitPointerLock(); return; }
      weapons.setEnabled(!player.swimming);
      if (nolock || touchUi()) return;
      player.lock(); // Enter / a click on SEND is the user gesture; if the lock is refused, fall back to the pause menu
      game.levelScope.timeout(400, () => { if (!document.pointerLockElement && hud.entered && !menu.isOpen && !feedbackHeld) hud.setPaused(true); });
    },
    toast: (t) => { if (explore?.active === true) explore.toast(t); else hud.toast(t); },
    touch: touchUi,
  })); return feedback; };
  app.input.bind('quickNote', () => { if (quickNote() && hud.entered && !menu.isOpen && !feedbackHeld) void loadFeedback().then((f) => f.openQuick()); }, game.levelScope);
  menu.onFeedbackTab = (panel) => { void loadFeedback().then((f) => f.mountTab(panel)); };
  // the ✎ NOTE tag: a tag of the base HUD's status column (src/client/engine/ui/hudSlots.ts), under the rows
  const noteDisc = document.createElement('button'); noteDisc.type = 'button'; noteDisc.className = 'ws-fb-disc';
  noteDisc.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 20l1-4L16 5l3 3L8 19z M14 7l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>Note<b class="ws-fb-badge"></b>';
  hudSlots.pill(noteDisc, () => { if (hud.entered && !feedbackHeld) void loadFeedback().then((f) => f.openSheet()); }, game.levelScope);
  const noteBadge = noteDisc.querySelector('b');
  const syncNoteDisc = () => {
    noteDisc.classList.toggle('show', quickNote() && touchUi() && hud.entered);
    const q = queuedCount(), badge = String(q); noteDisc.classList.toggle('queued', q > 0); if (noteBadge !== null && noteBadge.textContent !== badge) noteBadge.textContent = badge; // FC14: only on change
  };
  onReview(syncNoteDisc);
  progress.onEarned = (d) => { if (app.events.ask('feat.toast', { id: d.id, ...(d.event === undefined ? {} : { event: d.event }), allowed: true }).allowed) hud.toast(`Achievement · ${d.name} — title unlocked: ${d.title}`); if (!audio.cue('cue.feat.earned')) audio.hitMarker(); }; // a Nalati chapter's own caption announces its title
  const masterGain = () => { if (!audio.muted) audio.master.gain.setTargetAtTime(0.6 * getNumber('volume'), audio.ctx.currentTime, 0.05); };
  onNumber('volume', masterGain);

  const hands = new Hands(sky, game.camera, swimArms ?? null); // the swimming hands (shown only while player.swimming): the shard's arm rig swimming (Driftwood, E334), else white gloves
  const combatCues = new CombatCues(kit.combatCues(audio, boot.runtime.hooks.meleeSilent === true));
  if ('onHeavy' in crossbow) crossbow.onHeavy = () => { combatCues.cue(crossbow.row.cues?.heavy ?? 'cue.sword.heavy'); };
  // Content cue routing retains each weapon's existing sound source and fallback.
  weapons.onFire = () => {
    combatCues.fire(weapons.current.row);
  };
  weapons.onDry = () => { combatCues.cue(weapons.current.row.cues?.dry ?? 'cue.dry'); };
  weapons.onReloadStart = () => { combatCues.reload(weapons.current.row); };
  weapons.onSwap = () => { combatCues.cue('cue.swap'); };
  weapons.onImpact = (surface, point) => {
    if (surface !== 'flesh') getArena()?.miss(point);
    const dx = point.x - player.position.x, dz = point.z - player.position.z, d = Math.hypot(dx, dz);
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    const pan = d > 1 ? ((dx * rx + dz * rz) / d) * 0.7 : 0, gain = 1 / (1 + d / 12);
    combatCues.impact(weapons.current.row, { surface, point, pan, gain });
  };
  weapons.onHit = (_kind, headshot, killed) => {
    music.combat(0.7);
    hud.showHitMarker(headshot, killed);
    audio.hitMarker();
    if (killed) { kills++; audio.kill(); }
    buzz(killed ? HAPTIC.kill : HAPTIC.hit);
  };
  // aim assist reads the live array; Nalati hands it a filtered copy each frame (B9 / B15: a wolf hidden in long grass, the
  // horse you ride and the camp horses / Tulpar are not targets — the sabre's pass side reads the same list)
  const aimList: AimTarget[] = [];
  setAimTargets(aimList);
  // the AR-15 is found, not issued: a floating pickup on the floor of cabin 1 (the hollow), inside by the door wall
  // (cabin local frame: door on +X, chimney end -Z — Cabin.ts); "[E] Take AR-15" through the door / harvest prompt path
  if (params.get('weapon') === 'rifle' || params.get('weapon') === 'lever') { weapons.unlock('rifle'); weapons.select('rifle', true); boot.runtime.hooks.disposeRifleDrop?.(); } // dev: start with it
  weapons.placePickups(chunk.loadout ?? {}, { prompts: boot.runtime.interactables, owned: {
    has: (id) => { if (!isOwnedId(id)) throw new Error(`Unknown owned equipment: ${id}`); return owned.has(id); },
    grant: (id) => { if (!isOwnedId(id)) throw new Error(`Unknown owned equipment: ${id}`); owned.grant(id); },
  },
    onNear: (inside) => audio.pickupHum(inside),
    onPickup: (row) => { audio.hitMarker(); music.sting('pickup'); hud.pickupCard({ name: row.ui.name, icon: row.ui.icon }); },
    hold: params.get('weapon') === 'iron' ? 'weapon.sword-iron' : undefined });
  await weapons.settleSelection();
  // ── Nalati's adventure (NALATI-MERGE Q1–Q5: the camp's people, the quest line, places with saved discovery on the full map;
  // src/shards/nalati-grasslands/adventure.ts on the shared quest core) — null on any other shard ──
  // Registered cosmetics restyle the held model and persist in this shard's locker.
  const weaponModel = (w: SkinDef['weapon']) => { const model = weapons.get(w).model; return model instanceof THREE.Group ? model : null; };
  const wearSkin = (skin: SkinDef) => { const m = weaponModel(skin.weapon); if (m) { applySkin(m, skin, sky); effects.sync(weapons.get(skin.weapon), [{ id: `effect.finish.${skin.id}` }]); } skins.wear(skin.weapon, skin.id); };
  animals.onKill = (a) => {
    // a sword kill is at arm's length: "Reef crab · 1 m" read as a marker to crabs 30 m off (E296); a shot keeps its distance
    hud.killFeed(game.level.fight.telegraphed === true ? `${a.label} killed` : `${a.label} · ${Math.round(a.position.distanceTo(player.position))} m`);
    if (player.link === null) progress.recordKill(a.kind, a.variant);
  };
  // E314 stage 3: the body shadow (ShardManifest.bodyShadow, src/engine/player/BodyShadow.ts) — hidden off play (the title, a practice
  // room, the free camera / tour) — and Driftwood's keepsakes (src/shards/driftwood-isle/loot/keepsakes.ts): the sea glass chime + charms,
  // the trophy plaques and drops, the captain's hat; chains onKill after the loot's coin bursts
  const bodyShadow = chunk.bodyShadow === true
    ? installBodyShadow({ game, player, hidden: () => !hud.entered || practiceRoom.open || world.freeCamera || world.tour.active || explore?.active === true })
    : null;
  for (const { id: w } of weapons.list) { const s = skins.wearing(w); if (s) wearSkin(s); }
  new Combat(game, animals, weapons, game.camera); // health bars over animals + MMO-style damage / MISS floats (self-wiring); Combat only taps onFire / onImpact, which the manager forwards for every weapon
  // taking a hit (B3): the arc points at the attacker (src/client/engine/ui/HurtArc.ts), a hurt grunt panned toward it (Audio.hurt — it
  // used to be the landing thud), and the killer is remembered for the death toast (B2)
  const hurtArc = new HurtArc();
  const playerHurt = new PlayerHurt(app.events, game.levelScope, app.combat, playerHealth, {
    player, serverOwned: () => player.link !== null, directional: () => game.level.fight.telegraphed === true || boot.runtime.hooks.directional === true,
    flash: () => hud.damageFlash(), toast: (text) => hud.toast(text),
    combat: (value) => music.combat(value), hurt: (strength, pan) => audio.hurt(strength, pan), land: (hard) => audio.land(hard),
    arc: (x, z, at, yaw, damage) => hurtArc.hit(x, z, at, yaw, damage),
    trauma: (value) => CameraFX.for(game).addTrauma(value),
  });
  animals.onSound = (name, pos) => { audio.animal(name, pos, player.position, player.yaw); };
  // E297 fight rules (Driftwood): an amber edge chevron toward an enemy winding up where you can't see it (src/client/engine/ui/WindupWarn.ts);
  // chained after the wind-up's sound cue
  const windupWarn = Number.isFinite(game.level.fight.attackers) ? new WindupWarn<(typeof animals.animals)[number]>() : null;
  // the session owns the wind-up hook: the typed 'ai.windup' event first (listeners subscribe there), then the sound cue, then the edge chevron
  animals.onWindup = (a, duration) => { app.events.emit('ai.windup', { actor: a.combatActor(), duration }); audio.cue('cue.ai.windup', { kind: a.kind, point: a.position }); windupWarn?.start(a, duration); };
  // the dev fps panel's COUNTS (src/client/engine/ui/perfHud.ts; read ≤ 4× a second while it is open): who is running AI near you
  perf.addCounts(() => {
    let alive = 0, near = 0, motors = 0, chase = 0, flee = 0;
    for (const a of animals.animals) {
      if (!a.alive || a.hidden) continue;
      alive++;
      const d = a.position.distanceTo(player.position);
      if (d < 60) near++;
      if (a.motor !== null) motors++;
      if (a.state === 'charge' || a.state === 'stalk' || a.state === 'attack' || (a.state === 'sidestep' && d < 80)) chase++; // 'sidestep' = a Pine Hollow fight owns it (pinehollow/ctx.ts SCRIPTED): the elite, the bull's rivals
      else if (a.state === 'flee') flee++;
    }
    const ph = app.physics;
    return { animals: alive, near, motors, chase, flee, elite: boot.runtime.hooks.eliteEngaged?.() === true ? 1 : 0, bodies: ph?.world.bodies.len() ?? 0, colliders: ph?.world.colliders.len() ?? 0, 'fx chips': Impacts.count(game) };
  });
  player.onStep = (sprinting) => {
    const p = player.position;
    const surface = app.events.ask('player.stepSurface', { x: p.x, y: p.y, z: p.z, surface: boot.runtime.hooks.stepSurface?.(p) ?? 'litter' }).surface;
    if (!(player.wading && player.depth > 0.3) && audio.cue(`cue.step.${player.wading ? 'water' : surface}`, { speed: Math.hypot(player.velocity.x, player.velocity.z) })) return;
    if (player.wading) audio.wadeStep(player.depth, sprinting);
    else { const hoof = audio.hoofSurfaceAt?.(p.x, p.z); audio.footstep(sprinting, hoof !== undefined ? (hoof === 'wood' ? 'planks' : hoof) : surface); }
  };
  player.onEnterWater = (impact) => audio.splash(impact);
  player.onSubmerge = () => { audio.dive(); audio.cue('cue.player.dive'); audio.setUnderwater(true); music.setState({ underwater: true }); };
  player.onSurface = () => { audio.surface(); audio.cue('cue.player.surface'); audio.setUnderwater(false); music.setState({ underwater: false }); };
  player.onExitWater = () => audio.waterExit();
  player.onStroke = () => audio.swimStroke();
  player.onJump = () => audio.jump();
  player.onDodge = () => { audio.dodge(); buzz(HAPTIC.dodge); };
  lockSys.onLock = () => { audio.lockOn(); buzz(HAPTIC.lock); };
  lockSys.onSwitch = () => { audio.lockSwitch(); buzz(HAPTIC.lockSwitch); };
  lockSys.onUnlock = () => { audio.lockOff(); buzz(HAPTIC.lockBreak); };
  lockSys.onNone = () => { audio.lockNone(); };
  lockSys.onFlickMiss = (dir) => { lockOn.flashMiss(dir); };
  player.onLunge = () => { audio.lunge(); buzz(HAPTIC.lunge); };
  player.onLand = (hard) => playerHurt.fall(hard);
  // ── death (E295): a fade to dark with a "Mauled by a brown bear / respawning at Wreck Cove" card (src/client/engine/ui/DeathFade.ts),
  // the respawn under the dark at the last named place you reached (src/game/LastPlace.ts; Driftwood's places, the spawn
  // when none), input frozen and no hit taken until the view is back. A boss fight's death keeps its own checkpoint. ──
  const deathFade = new DeathFade();
  const placePts = boot.runtime.hooks.places;
  const lastPlace = placePts !== undefined ? new LastPlace(placePts) : null;
  if (lastPlace !== null) {
    let since = 0;
    game.onUpdate((dt) => {
      since += dt;
      if (since < 0.25) return;
      since = 0;
      if (deathFade.active || !hud.entered || world.freeCamera || world.tour.active || away() || practiceRoom.open) return; // a practice room is never the checkpoint (E321)
      if (gridLive !== null && !gridLive.ownsHomeRecovery()) return;
      const p = player.position, ph = app.physics;
      const floor = ph ? floorBelow(ph, p.x, p.z, p.y + 0.6, 1.2) : undefined; // real walkable footing under the feet
      const grounded = floor !== undefined && Math.abs(floor - p.y) < 0.3 && player.onGround && !player.swimming && !player.wading && !player.hover
        && !player.carried && player.ride === null && floor > (app.world.water.level ?? -Infinity) + 0.3;
      lastPlace.observe({ x: p.x, y: floor ?? p.y, z: p.z, grounded });
    }, 'last place');
  }
  let serverRespawn: (() => void) | null = null;
  const serverDied = (event: { checkpoint: boolean; cause?: DeathCause }, resume: () => void): void => {
    serverRespawn = resume;
    app.events.emit('player.died', { actor: playerHealth, checkpoint: event.checkpoint, ...(event.cause === undefined ? {} : { cause: event.cause }) });
  };
  const die = (by: DeathCause | undefined): void => {
    const stand = gridLive !== null && !gridLive.ownsHomeRecovery() ? null : lastPlace?.stand ?? null;
    music.sting('death');
    player.carried = true; weapons.setEnabled(false); // frozen: the fixed step leaves the body alone, no swing / shot
    deathFade.play(deathCause(by ?? null), respawnWhere(chunk, stand !== null && stand.id !== 'pier' ? placeName(stand.label) : null, app.levelRegistrations.findText('respawn.default', game.levelScope)), {
      dark: () => {
        if (serverRespawn !== null) { serverRespawn(); serverRespawn = null; }
        else if (stand !== null && stand.id !== 'pier') player.spawn(stand.x, stand.z, stand.yaw, stand.y); else toSpawn();
      }, // a server owns its return; a local player uses the last place (the pier is the spawn)
      done: () => { player.carried = false; weapons.setEnabled(!player.swimming); },
    });
  };
  playerHealth.bindLifecycle({ fading: () => deathFade.active, updateFade: (dt) => deathFade.update(dt) });
  installPlayerDeath(app.events, game.levelScope, playerHealth, {
    active: () => app.player === playerHealth, position: () => player.position,
    died: (cause, checkpoint) => {
      audio.death(); hud.damageFlash();
      if (!checkpoint || (gridLive?.spawn() ?? null) !== null) die(cause);
      else { serverRespawn?.(); serverRespawn = null; }
    },
  });
  // ── first-time control hints (E308, src/client/engine/ui/FirstHints.ts: every shard's one system; after main's onJump / onDodge, which
  // it chains): a label + pulsing ring on the touch control the first time it matters. Driftwood feeds its six triggers
  // (src/shards/driftwood-isle/firstMinutes.ts); another shard shows none until it feeds its own ──
  const firstHints = new FirstHints(player, { touch: touchControls.active, paused: () => !hud.entered || hud.paused || deathFade.active || away() || world.freeCamera || world.tour.active });
  game.onUpdate((dt) => { firstHints.update(dt); }, 'first hints');

  // ── menu ↔ world: the world is fully loaded, then sits frozen and silent under the menu (hero art
  // covers the canvas) until ENTER WORLD. Main-menu exit releases this entire page session;
  // practice and Explore keep their own local return path. `?skipintro=1` (bench / screenshots) and `?tour=1` go straight to the world.
  const tour = world.tour;
  // a GPU-recovery reload (E61) skips the title: straight back into the world at the saved spot, under the pause menu
  if (session.crashResume !== undefined) {
    const pose = session.crashResume.pose;
    player.spawn(pose.x, pose.z, pose.yaw, pose.y); player.pitch = pose.pitch;
  }
  const resuming = session.crashResume !== undefined || session.recovery !== undefined || params.has('glreload');
  const continuingGridEntry = session.crashResume !== undefined || plannedGridReload(session.recovery);
  const arrival = session.arrival;
  const menuFirst = arrival === null && !params.has('skipintro') && !params.has('tour') && !resuming;
  let firstIn = true;
  let fromTitle = false; // pause → "Exit to main menu" → ENTER WORLD starts over at the spawn (E121), a plain resume does not
  const enter = () => {
    if (fromTitle) { fromTitle = false; toSpawn(); lastPlace?.reset(); }
    audio.resume();
    audio.worldMuted = false;
    if (!music.isPlaying) music.play('theme'); // normally already playing: the title screen's first gesture started it
    if (firstIn) { firstIn = false; music.sting('chunk'); } // the resolve chord on the first frame in
    music.setState({ mode: 'calm', intensity: 0 }); // title → the shard's theme, crossfaded on a bar
    void keepAlive.start(); // screen wake lock — needs this user gesture
    weapons.setEnabled(true);
    weapons.visible = true;
    perf.setActive(true);
    if (tour.active && !params.has('tour')) { tour.active = false; respawn(); }
    if (!nolock) player.lock();
  };
  const enterArena = async (): Promise<void> => {
    try {
      const arena = await prepareArena();
      if (game.levelScope.disposed || !hud.entered) return;
      arena.enter(player, weapons); setAimTargets(arena.targets); minimap.setPracticeArena(chunk.spawn); menu.setPractice(true);
    } catch (error) { console.warn('Practice room unavailable', error); if (!game.levelScope.disposed) hud.startExplore(); }
  };
  hud.onArena = () => { void enterArena(); };
  hud.onResume = enter;
  hud.onExitToMain = () => { exitSessionToTitle(); };
  hud.onExitToMenu = () => {
    getArena()?.exit(); playground?.exit(); playground = null; minimap.setPracticeArena(null); menu.setPractice(false); setAimTargets(aimList); fromTitle = true; weapons.setEnabled(false); perf.setActive(false); audio.worldMuted = true; music.setState({ mode: 'menu' }); noteDisc.classList.remove('show');
  };

  // ── Explore World (project/archive/2026-09-23-explore-world.md): the title's EXPLORE WORLD panel — the viewer over this same loaded shard (a
  // lazy chunk). God-mode camera, Model Explorer, one ✎ to the review inbox; ✕ comes back here to the title.
  const exitExplore = () => {
    perf.setActive(false); audio.worldMuted = true; music.setState({ mode: 'menu' }); hud.showIntro(enter);
  };
  const noteSheet = async (): Promise<void> => { const f = await loadFeedback(); await f.openSheet(); };
  // E307: a playground's card — its scene loads (and builds, the first time) while Explore's last frame stays up, then the
  // world is entered straight into it, the pause menu's exit leading back to the hub, as from the Practice arena
  const enterPlayground = async (id: PlaygroundId): Promise<void> => {
    let pg: Playground;
    try {
      pg = await loadPlayground(id, { game, player, registry, physics: world.physics, spawn: chunk.spawn, toast: (t) => { hud.toast(t); }, animals });
    } catch (error) {
      console.warn(`[playground] ${id} did not load`, error);
      hud.startExplore();
      return;
    }
    hud.enterNow();
    if (!hud.entered) return;
    playground = pg;
    pg.enter();
    setAimTargets([]); minimap.setRoom(pg.map); menu.setPractice(true, pg.title); // E321: the room's own map, not the shard's
  };
  const openExplore = async (mode: ExploreMode, opts: { cam?: number[]; model?: string } = {}): Promise<void> => {
    beginExploreEntry(mode);
    audio.resume();
    audio.worldMuted = false;
    if (!music.isPlaying) music.play('theme');
    music.setState({ mode: 'calm', intensity: 0 });
    void keepAlive.start();
    weapons.setEnabled(false); weapons.visible = false;
    perf.setActive(false); // the Explore readout carries fps / calls / tris
    const t0 = performance.now();
    const { Explore: X } = await loadExplore();
    const t1 = performance.now();
    recordBootCheckpoint('explore:imported');
    explore ??= new X({ world, title: { name: manifest.name, landscape: manifest.card.landscape, thumb: manifest.card.thumb }, onExit: exitExplore, onPractice: () => { hud.enterArenaNow(); }, onPlayground: (id) => { void enterPlayground(id); }, openFeedback: () => { void noteSheet(); }, hide: [boundary.group], creatures: animals.animals,
      overhead: boot.runtime.overhead });
    const t2 = performance.now();
    recordBootCheckpoint('explore:constructed');
    explore.open(mode, opts);
    console.info(`[explore] open: import ${Math.round(t1 - t0)} ms · build ${Math.round(t2 - t1)} ms · open ${Math.round(performance.now() - t2)} ms`);
  };
  const exploreParam = params.get('explore');
  const exploreMode: ExploreMode = exploreParam === 'world' || exploreParam === 'model' || exploreParam === 'sets' ? exploreParam : 'hub';
  hud.onExplore = () => { void openExplore('hub'); };
  // Not a frame is rendered or ticked while the menu is up: hud.entered is the gate.
  game.frameGate = () => ((hud.entered && !hud.paused) || exploring()) && !feedbackHeld && !app.ui.still && !rotateGated() && !shardCompleteUp() && (gridLive?.gameplayReady() ?? true); // Entered runtime installation finishes before another input or gameplay tick.
  if (menuFirst) { weapons.setEnabled(false); weapons.visible = false; perf.setActive(false); audio.worldMuted = true; hud.showIntro(enter); }
  else if (arrival?.mode === 'explore') { weapons.setEnabled(false); weapons.visible = false; perf.setActive(false); hud.setOnEnter(enter); } // Explore ▸ Practice enters through it without the title: no handler left the weapon off and the DODGE disc dead (E285)
  else { hud.markEntered(enter); weapons.setEnabled(!nolock || params.has('skipintro')); }
  // the grid's player-facing moments: G98's sky-down reveal to the pier (G622 D1: 3 s, any touch or key takes over), then
  // G78's SAFE ZONE + dimmed ATTACK on the road, G82 / G105's title card on entering a shard, G97's speed look (gridHud.ts)
  if (grid !== null) {
    const [{ installGridReveal }, { installGridHud }, { installBudgetOverlay }, { installMinimapBlend }, { loadGridMapAtlas }] = await Promise.all([
      import('../grid/reveal'), import('../grid/gridHud'), import('../grid/budgetOverlay'), import('../grid/minimapBlend'), import('../grid/mapAtlas'),
    ]);
    if (game.levelScope.disposed || game.levelScope.disposing) throw new Error('Grid owner retired while loading presentation');
    const revealing = session.recovery === undefined || initialGridReload(session.recovery) ? installGridReveal({ scope: game.levelScope, camera: game.camera, hudRoot: hud.root, canvas: game.renderer.domElement, onLate: (fn) => { game.onLate(fn, 'game.grid.reveal'); },
      home: chunk.name, ringsReady: () => grid.ringsReady(), homeSimReady: () => !gridHomeSim.pending, weapons, viewmodel: game.viewmodel, entered: () => hud.entered }) : () => false;
    // A1: markEntered precedes the reveal and home installation. Open outer
    // seams/road/far and near views only after the first controllable frame.
    // Latch once: pausing later must not retire already admitted outer views.
    whenControl(game.levelScope, game.levelScope, () => { gridControlReady = true; });
    // T10 (G777): and only once the spawn has drawn ~3 s of play after control, or the player has moved 2 m from where
    // control began (a walk or a ride opens it at once, so a crossing never waits on it): the neighbour products, outer
    // strips and views were single 14-36 ms tasks inside the spawn view's first seconds (Simulator spawn p95 55-66 ms)
    let settledMs = 0, controlAt: { readonly x: number; readonly z: number } | null = null;
    game.onLate((dt) => {
      if (gridBackgroundReady || !(gridControlReady && hud.entered && !hud.paused && !revealing() && !gridHomeSim.pending)) return;
      controlAt ??= { x: player.position.x, z: player.position.z }; settledMs += dt * 1000;
      if (settledMs >= GRID_SPAWN_SETTLE_MS || Math.hypot(player.position.x - controlAt.x, player.position.z - controlAt.z) >= GRID_SPAWN_SETTLE_METRES) gridBackgroundReady = true;
    }, 'game.grid.background');
    const gridHud = installGridHud({ scope: game.levelScope, hudRoot: hud.root, camera: game.camera, cells: gridCells,
      title: (cell) => { const shard = findShard(cell.slug); return { name: shard?.name ?? cell.slug, subtitle: shard?.biome ?? '' }; },
      accent: (cell) => { const id = findShard(cell.slug)?.accent; return id === undefined ? null : ACCENTS[id]; },
      velocity: () => player.velocity, live: () => hud.entered && !hud.paused && !revealing(),
      onInput: (fn) => { game.onInput(fn, 'game.grid.hud.fov'); }, onLate: (fn) => { game.onLate(fn, 'game.grid.hud'); } });
    // G107: the minimap blends at the road boundary (the shard + the road + the neighbours' names inside; faded terrain on the road)
    const atlas = await loadGridMapAtlas(game.levelScope, grid.allocator, __GRID_MAP_ATLAS__);
    const blend = installMinimapBlend(minimap, { assembly: grid.assembly, home: grid.home, cells: gridCells, worldFeet: () => grid.worldFeet(), image: (id) => grid.mapImage(id),
      name: (cell) => findShard(cell.slug)?.name ?? cell.slug }, game.levelScope, fullMap, atlas); // Full map is complete before the first Bag open.
    // playtest round 3: the menu names the shard whose cell you are in (the full map's arrow reads mapAt's home frame too)
    game.levelScope.onDispose(gridCells.onEnter((cell) => { menu.setLevelName(findShard(cell.slug)?.name ?? cell.slug); }));
    // SF38 / G30: Developer mode's points budget over the one live allocator (no element or timer until Developer is on)
    const slugCount = new Map<string, number>();
    for (const cell of grid.assembly.cells) slugCount.set(cell.slug, (slugCount.get(cell.slug) ?? 0) + 1);
    const cellName = new Map(grid.assembly.cells.map((cell) => { const name = findShard(cell.slug)?.name ?? cell.slug; return [cell.instance, (slugCount.get(cell.slug) ?? 0) > 1 ? `${name} ${cell.cell[0]},${cell.cell[1]}` : name]; }));
    const memory = session.memory;
    const budget = installBudgetOverlay({ scope: game.levelScope, allocator: grid.allocator, name: (owner) => cellName.get(owner) ?? owner, shard: (owner) => cellName.has(owner),
      ...(memory === undefined ? {} : { overLimit: () => residentOverLimit(memory) }) });
    // G628 M7: the strip's trend reads the headline at each cell entry
    game.levelScope.onDispose(gridCells.onEnter(() => { budget.crossed(); }));
    game.levelScope.onDispose(app.debug.scopedExpose('gridBudget', budget));
    game.levelScope.onDispose(app.debug.scopedExpose('gridHud', { state: gridHud, minimap: () => { const o = blend(); return { baseAlpha: o.baseAlpha ?? 1, images: o.images.map((m) => ({ x: m.x, z: m.z, alpha: m.alpha })), labels: o.labels.map((l) => l.text) }; } }));
  }
  // ?explore=hub|world|model|sets[&cam=x,y,z,yaw,pitch][&model=id] — straight into the viewer (a shard with ShardManifest.explore — D4, E66; a note's "go there")
  let startExplore: (() => void) | undefined;
  if (exploreParam !== null && chunk.explore !== undefined) {
    const cam = (params.get('cam') ?? '').split(',').filter((v) => v !== '').map(Number);
    const model = params.get('model');
    hud.onExplore = () => { hud.onExplore = () => { void openExplore('hub'); }; void openExplore(exploreMode, { ...(cam.length >= 3 ? { cam } : {}), ...(model !== null ? { model } : {}) }); };
    // The loader still has the shard's level.play hook to install. Opening
    // Explore parks the player outside the bounded script world; defer that
    // presentation move until finishStage has installed the gameplay owners.
    startExplore = () => { hud.startExplore(); };
  }
  // the first gesture builds the AudioContext; on the title screen it also starts the title theme (synth, then the title stems)
  const firstGesture = () => { audio.resume(); if (!hud.entered && !music.isPlaying) music.play('theme'); };
  app.input.firstGesture(firstGesture, game.levelScope);

  // ── interaction (doors, chests, pickups, carcasses): the nearest one within its radius that the eye can SEE (PHYSICS P5 —
  // a Rapier ray from the camera; a door or chest behind a wall neither prompts nor opens) ──
  // a cabin door's prompt stands 0.5 m out from its leaf: seen from inside, the shut leaf is its own body, not a wall
  const carcassAt = new THREE.Vector3();
  let prompt: string | undefined;
  let nearest: (typeof boot.runtime.interactables)[number] | undefined;
  let carcass: (typeof animals.animals)[number] | undefined;
  app.input.bind('use', () => {
    if (!hud.entered) return;
    if (nearest) { tap.use?.(nearest.label); if (nearest.wireId !== undefined) wirePage.send(nearest.wireId); nearest.onInteract(); }
    else if (carcass && boot.runtime.hooks.harvestBusy?.() !== true) {
      const selectedCarcass = carcass;
      harvested.add(selectedCarcass);
      const drops = inventory.harvest(carcass.kind, carcass.variant); // Pine Hollow: only what Mott takes (E314 C)
      const show = (got: readonly ItemId[]): void => {
        const said = `${got.map((id) => ITEMS[id].label).join(' + ') || 'Nothing'} harvested · ${inventory.total} in the pack`, first = got[0];
        if (first === undefined) hud.toast(said);
        else hud.pickupCard({ name: got.map((id) => ITEMS[id].label).join(' + '), icon: ITEMS[first].icon, detail: `${inventory.total} in the pack` });
        audio.hitMarker();
      };
      const give = (): void => {
        if(wirePage.client !== null && wirePage.line('harvest.enabled') > 0) {
          wirePage.harvest(game.levelScope, selectedCarcass.entityId, selectedCarcass.kind, selectedCarcass.variant,
            got => { show(got.filter(isItemId)); });
        } else show(drops.filter(id => inventory.add(id)));
      };
      if (boot.runtime.hooks.harvest) boot.runtime.hooks.harvest(selectedCarcass, give, () => { harvested.delete(selectedCarcass); }); // PH-F2: the skinning beat, then the drops; the carcass stays for the ravens
      else { give(); carcass.fadeOut(); }
    }
  }, game.levelScope);

  // G107: in the grid the minimap reads the home frame's metres (the traveller's own position is its current frame's)
  const mapAt = (): { x: number; z: number } => {
    if (grid === null) return player.position;
    const feet = grid.worldFeet(); return { x: feet.x - grid.home.origin.x, z: feet.z - grid.home.origin.z };
  };
  let musicPoll = 0;
  const alertOnlyHostile = manifest.audio?.alertOnlyHostile === true;
  // the dev fps panel's split of this updater (src/shared/engine/core/frameCost.ts; free while the panel is closed): `mark(b)` books the
  // time since the last mark to bucket b, `unmark()` leaves it in 'other'
  let markT = 0;
  const mark = (b: Bucket): void => { if (frameCost.on) { const now = performance.now(); frameCost.section(b, markT); markT = now; } };
  const unmark = (): void => { if (frameCost.on) markT = performance.now(); };
  game.onUpdate((dt, t) => {
    unmark();
    // music: once a second (not per frame) — an animal that has noticed you within 40 m lifts calm → alert; combat comes from the hit hooks and decays by itself
    if (t - musicPoll > 1) {
      musicPoll = t;
      syncNoteDisc(); // the ✎ disc follows entered / the touch layer / the Quick note switch, once a second
      if (music.state.mode !== 'combat' && music.state.mode !== 'menu') {
        // (the steppe's herds and the flock dog go 'alert' as you ride by: only a hostile one lifts Nalati's score — NALATI-MERGE A2)
        const noticed = animals.animals.some((a) => a.alive && (a.state === 'alert' || a.state === 'stalk') && (!alertOnlyHostile || a.aggressive) && a.position.distanceTo(player.position) < 40);
        music.setState({ mode: noticed ? 'alert' : 'calm', intensity: noticed ? 0.5 : 0 });
      }
    }
    boundary.update(dt, t);
    // Driftwood's ocean · boat · palms · gulls · bridge planks · seabed · cove · shrine: its plugin's systems (src/shards/driftwood-isle/world/systems.ts)
    mark('world');
    hands.update(dt, player);
    mark('player');
    horizon.update(dt, game.camera);
    boot.runtime.hooks.worldUpdate?.(dt, t);
    mark('world');
    // swimming holsters the weapon (hands only; Hands.ts follows)
    if (player.swimming !== swimHold) { swimHold = player.swimming; weapons.visible = !swimHold; weapons.setEnabled(!swimHold); }
    unmark();
  }, 'main.world');
  app.addSystem({ id: 'engine.creatures.update', phase: 'update', after: ['main.world'], before: ['main.equipment'], run: (dt, t) => {
    const homeActive = grid === null || gridLive === null;
    aimList.length = 0;
    if (homeActive) {
      animals.update(dt, t, player.position, viewer(), game.camera);
      aimList.push(...app.events.ask('combat.aimTargets', animals.animals.filter((a) => a !== player.mountedOn)));
    } else if (gridLive !== null) {
      aimList.push(...app.events.ask('combat.aimTargets', gridLive.aimAnimals().filter((a) => a !== player.mountedOn)));
    }
  } }, game.levelScope);
  app.addSystem({ id: 'main.equipment', phase: 'update', after: ['engine.creatures.update'], before: ['engine.audio.listener'], run: (dt, t) => {
    mark('animals');
    weapons.update(dt, t); // every weapon ticks (bolts in flight keep flying while the rifle is out)
    boot.runtime.hooks.equipmentUpdate?.(dt); weaponStrip.update();
    boot.runtime.hooks.updatePickups?.(dt, t);
    weapons.updatePickups(dt, t);
    mark('player');
  } }, game.levelScope);
  app.addSystem({ id: 'engine.audio.listener', phase: 'update', after: ['main.equipment'], before: ['main.frame'], run: () => {
    audio.listenerYaw = player.yaw;
  } }, game.levelScope);
  app.addSystem({ id: 'main.frame', phase: 'update', after: ['engine.audio.listener'], before: ['engine.player.hud'], run: (dt) => {
    boot.runtime.hooks.audioUpdate?.(dt);
    mark('audio');

    // nearest interactable: standalone and in the grid's home frame the page runtime's own; inside an entered runtime cell
    // (Sky Reach's RIDE, a cell's talk / pickup / open) that cell's own, in its frame (grid-interact, src/client/game/grid/enteredInteract.ts)
    const physics = app.physics;
    const homeActive = grid === null || gridLive === null;
    nearest = gridLive === null ? pickInteractable(boot.runtime.interactables, game.camera.position, physics)
      : gridLive.pickPrompt(homeActive ? boot.runtime.interactables : gridLive.interactables(), game.camera.position, physics);
    carcass = undefined;
    if (!nearest && homeActive) for (const a of animals.animals) {
      if (a.alive || harvested.has(a) || a.position.distanceTo(player.position) >= 2.6) continue;
      if (inventory.harvest(a.kind, a.variant).length === 0) continue; // nothing to take (Pine Hollow's elk: E314 C) (the drowned sailor / captain fade): no [E] Harvest (E318 row 17)
      if (physics && !lineOfSight(physics, game.camera.position, carcassAt.copy(a.position).setY(a.position.y + 0.4), 0.6)) continue; // not through a wall (animals aren't physics yet: their body blocks nothing)
      carcass = a; break;
    }
    prompt = nearest ? `[E] ${nearest.label}` : carcass ? `[E] Harvest ${carcass.label || carcass.kind}` : undefined; // "Harvest Royal bull", not "Harvest elk"
    // E296: no prompt over a fight on a melee shard — in the wreck's hold the guarded sword's and the jammed winch's (on the
    // phone the big USE band) sat across the drowned sailor. A fight = a hit in the last 3 s, or an enemy on you within 5 m;
    // E still works
    if (prompt !== undefined && game.level.fight.telegraphed === true) {
      let fighting = performance.now() - playerHealth.lastHurt < 3000;
      for (const a of animals.animals) {
        if (fighting) break;
        fighting = a.alive && a.aggressive && (a.state === 'attack' || a.state === 'stalk' || a.state === 'charge') && a.position.distanceToSquared(player.position) < 25;
      }
      if (fighting) prompt = undefined;
    }

  } }, game.levelScope);
  game.onUpdate((dt) => {
    unmark();
    hurtArc.update(dt, player.position, player.yaw);
    windupWarn?.update(dt, game.camera, player.position, player.yaw, animals.isThreat);

    const edge = CHUNK_HALF - Math.max(Math.abs(player.position.x), Math.abs(player.position.z));
    hud.setBoundaryWarning(grid === null && !away() && edge < 14 && hud.entered); // in the grid the chunk edge is a seam, not a boundary
    hud.setAimInfo(aimReadout(weapons.aimInfo)); // a boss by its name (PH-C1)
    lockOn.update();
    speedLines.update(dt, player.dashing, meleeLock.lunging);
    // G782: held at a cell's wall, the maps redraw every 4th drawn frame (a held second shows no travel)
    if (hud.entered && heldFrameTurn(4)) { const at = mapAt(); hud.setAnimals(away() ? [] : animalPositions(animals.animals)); minimap.update(at, player.yaw, away() ? [] : animals.animals); fullMap.update(at, player.yaw); } // a practice room's map is its own (Minimap.setRoom, E321), not the shard's terrain
    hud.setState({
      bolts: weapons.state.ammo, maxBolts: weapons.state.magazine, reserve: weapons.state.reserve, loaded: weapons.state.loaded, reloading: weapons.state.reloading, reloadProgress: weapons.state.reloadProgress,
      weaponUi: weapons.current.row.ui,
      health: playerHealth.attributes.health, maxHealth: playerHealth.attributes.maxHealth, pos: { x: player.position.x, z: player.position.z }, yaw: player.yaw, kills,
      prompt, speed: player.speedFactor, ads: weapons.state.ads,
    });
    mark('hud');
  }, 'engine.player.hud');
  playerHealth.checkpoint(game.levelScope, () => boot.runtime.hooks.checkpoint?.() === true, () => app.player === playerHealth);
  app.events.on('player.respawned', () => {
    if (app.player !== playerHealth) return;
    if (crossbow.hasAmmo) crossbow.addBolts(30 - (crossbow.state.bolts ?? 30));
  }, game.levelScope);
  app.addSystem({ id: 'engine.player.regen', phase: 'update', after: ['main.frame'], before: ['engine.player.hud'], run: (dt) => playerHealth.update(dt) }, game.levelScope);

  // `?at=x,y,z,yaw,pitch` — a review note's repro URL (src/client/engine/ui/Feedback.ts reproUrl) starts you on the spot it was filed from
  const at = (params.get('at') ?? '').split(',').map(Number);
  if (session.recovery === undefined && at.length >= 3 && at.every((v) => Number.isFinite(v))) {
    const [x = 0, y = 0, z = 0, yaw = player.yaw, pitch = 0] = at;
    // y is in the level's authored frame (every `?at=` writer takes the runtime datum off, G164): stand on the same ground in either state
    player.position.set(x, y + terrainDatum(), z); player.yaw = yaw; player.pitch = pitch;
  }
  // back from a GPU-recovery reload (E54): the pose is applied; take it off the address so a later reload spawns as usual
  if (params.has('glreload')) { const u = new URL(location.href); u.searchParams.delete('glreload'); u.searchParams.delete('at'); history.replaceState(history.state, '', u); }

  app.ui.bind(game.levelScope, () => hud.promptText);
  boot.runtime.play = { animals, weapons, primary: crossbow, rifle, secondary: longbow, inventory, owned, progress, hud, menu, fullMap, audio, music, skins, wearSkin, touchUi, nolock, disposeRifleDrop: () => { boot.runtime.hooks.disposeRifleDrop?.(); }, cues: combatCues, firstHints, minimap, bodyShadow };
  const getPlayground = (): Playground | null => playground;
  return { ...ctx, grid, gridLive, leakPhysics, perf, audio, music, playerHealth, serverDied, serverHurt: (amount: number, point: THREE.Vector3, blow: boolean) => { playerHurt.serverHit(amount, point, blow); }, exploring, hands, windupWarn, resuming, continuingGridEntry, arrival, menuFirst, enter, getPlayground, minimap, startExplore };
}

export const playStage: typeof buildPlay = buildPlay;

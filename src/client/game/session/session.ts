import { bagMenu } from '../bag/tabs';
import { wirePage } from '../shardfile/wirePage';
import * as THREE from 'three';
import { type LevelSequence, bootLevel } from '@wildshard/engine/boot';
import { retried } from '@wildshard/engine/boot/retry';
import type { LevelContext } from '@wildshard/engine/level/context';
import type { SkinDef } from '@wildshard/engine/player/Skins';
import { shardContext, pageGridInstance, type GameServices, type ShardContext, type PageMode } from '../plugin/context';
import { regionalDataCellBytes } from '../grid/runtimeCost';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { bootPageMode } from '../grid/pageEntry';
import type { ShardManifest } from '../shard/manifest';
import { toLevelSpec } from '../shard/spec';
import { playable } from '../shard/registry';
import { catalogueManifests } from '../shard/titleList';
import { shardArt } from '../shard/list';
import { runShardLoad, withShardHooks, ShardLoadError, type LoadStage } from '../shard/load';
import type { KitPorts, BuiltWorld, SessionState, StagedBoot, SessionContext } from './context';
import { dataStage } from './data';
import { worldStage } from './world';
import { loadoutStage } from './loadout';
import { playStage } from './play';
import { finishStage } from './finish';
import { currentOwner, enterOwner } from '@wildshard/engine/app/ownership';
import { app } from '@wildshard/engine/app/runtime';
import { reportSpawnOutcomes } from '../boot/spawnDownload';
import { pageScope } from '@wildshard/engine/app/resources';
import { Scope } from '@wildshard/engine/app/scope';
import { markBootHandledError } from '@wildshard/engine/boot/bootTrace';
import { setBootCatalog } from '@wildshard/engine/boot/catalog';
import { setAliveSource, type AliveInfo } from '@wildshard/engine/boot/lastEnd';
import { PLAYING, markDropStep, noteDropError } from '@wildshard/engine/boot/dropNotice';
import { consumeTitleArrival } from '@wildshard/engine/boot/titleArrival';
import { reportError } from '@wildshard/engine/core/errorReport';
import { pageSeed } from '@wildshard/engine/core/rng';
import { LevelLoadError } from '@wildshard/engine/level/load';
import { registerPlayground } from '@wildshard/engine/practice/playground/catalog';
import { textureBytes } from '@wildshard/engine/render/textureBytes';
import { installErrorModal, showError } from '@wildshard/engine/ui/ErrorModal';
import { registerLevelDebugRow } from '@wildshard/engine/ui/debugOptions';
import { showLoadFailure } from '@wildshard/engine/ui/errorScreen';
import { installWorldRegistry } from '@wildshard/engine/world/registry';

import { installProductGround, installProductSampling } from '../shardfile/productGround';
import { installProductNavigation } from '../shardfile/productNavigation';
import { loadManifestProduct, manifestAdmittedSource } from '../shardfile/runtimeProduct';
import { absentShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { gridLevel } from '../../../shared/game/grid/pageMode';
import type { PageResidency } from '../grid/pageResidency';
import type { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import { gridPageShell, gridPageShellLevel, selectGridPageShell, GridPageShellPlugin, useOwnedGridHome } from '../grid/pageShell';

declare const __BUILD_ID__: string;

/** Early root selection avoids consuming the grid intent a second time after descriptor hydration. */
export interface SessionOptions { readonly mode?: PageMode; readonly residency?: PageResidency; readonly memory?: MemoryAdmission; readonly recovery?: SessionState['recovery']; readonly crashResume?: SessionState['crashResume'] }

/** Game presentation and plugin discovery belong to the game adapter, after the root selects content. */
export async function startSession(manifest: ShardManifest, kit: KitPorts, options: SessionOptions = {}): Promise<void> {
  installWorldRegistry(); // the level's pieces and colliders register here (before the boot builds anything)
  installProductGround(); // a required manifest ground reads its shard's own admitted product (before any level loads)
  installProductSampling(); // an optional bake its shard admitted as query terrain reads that product, never terrain.bin too
  installProductNavigation(); // declared navigation its shard's product admitted reads that product, never navmesh.bin too
  // DL20: every boot's level download outcome (cached, downloaded, failed or cancelled) reaches telemetry once, including
  // one that settled before this session and one whose failure stops the boot
  const confirmOutcomes = reportSpawnOutcomes(outcome => { app.events.emit('download.parts', outcome); });
  // they leave the device save only once this session's events have reached telemetry (sp-x6's review of b28a44a5e6)
  app.events.on('level.loaded', () => { confirmOutcomes(); }, pageScope);
  // the boot and the background download read the registry through the engine's catalog (E405: no engine → game import)
  const levels=catalogueManifests(),byId=new Map<string,(typeof levels)[number]>(levels.map(row=>[row.slug,row]));
  setBootCatalog({ levels, playable: levels.filter(playable), find:id=>byId.get(id), artBytes: shardArt() });
  installErrorModal();
  const session: SessionState = { music: null, arrival: null, fatalShown: false, ...(options.crashResume === undefined ? {} : { crashResume: options.crashResume }), ...(options.memory === undefined ? {} : { memory: options.memory }), ...(options.recovery === undefined ? {} : { recovery: options.recovery }), ...(options.residency === undefined ? {} : { residency: options.residency }) };
  try {
    app.rng.seed(pageSeed(manifest.seed, window.__wildshardHarness?.seed));
    const selected = manifest.slug;
    session.arrival = consumeTitleArrival(selected);
    // SF21a: the one-shot EXPERIMENTAL Wildshard intent, consumed by every boot; grid mode drops the URL to the title's
    const mode = options.mode ?? bootPageMode(selected);
    session.ownedGridHome = useOwnedGridHome(mode, manifest, manifestAdmittedSource(manifest));
    const pageManifest = session.ownedGridHome ? gridPageShell(manifest) : manifest;
    if (mode === 'grid' && options.residency === undefined) throw new Error('Grid boot requires residency admission before hydration');
    // T7: an owned data home has no data page to admit its claim; admit it at the regional charge its entry hands off
    const homeSource = manifestAdmittedSource(manifest), homeInstance = pageGridInstance();
    if (session.ownedGridHome && homeSource?.runtime === null && !hasDeclaredClientPage(homeSource) && options.residency !== undefined && homeInstance !== null
      && !options.residency.allocator.has(`sim:${homeInstance}`)) options.residency.admitHome(homeInstance, regionalDataCellBytes(manifest.slug, homeSource, manifest));
    setAliveSource((): AliveInfo<PageMode> => ({ slug: selected, resident: '', mode }));
    if (matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true) {
      const home = new URL(location.href);
      if (home.searchParams.has('chunk') || home.searchParams.has('v')) {
        home.searchParams.delete('chunk'); home.searchParams.delete('v');
        history.replaceState(history.state, '', home);
      }
    }
    const scope = new Scope('level');
    if (session.ownedGridHome) scope.onDispose(selectGridPageShell(pageManifest));
    // Register first: the scope's later consumer cleanup runs before the final early boot reference is released.
    if (options.residency !== undefined) scope.onDispose(() => { options.residency?.dispose(); });
    if (options.memory !== undefined) scope.onDispose(() => { options.memory?.dispose(); });
    enterOwner(scope);
    const world = await runShardLoad(manifest, (stage) => withShardHooks(manifest, stage,
      () => buildSession(pageManifest, stage, kit, session)), {
      build: __BUILD_ID__, dispose: () => {
        if (app.render !== null) app.render.hold = true;
        scope.dispose();
      // SENTRY-TRIAGE S13: a failure whose page the player sees says so (`screen:load-failure`); a recovery's stays a plain report
      }, report: (failure) => reportError(options.recovery === undefined ? { ...failure, tags: { ...failure.tags, screen: 'load-failure' } } : failure),
      show: (failure) => { if (options.recovery !== undefined) return; session.fatalShown = true; showLoadFailure(failure); },
    });
    let memoryAt = -Infinity, memoryMB = 0;
    const memory = (maxAgeMs = 5000) => {
      const now = app.clock.real * 1000;
      if (now - memoryAt >= maxAgeMs) { memoryAt = now; memoryMB = Math.round(textureBytes(world.scene) / 1e5) / 10; }
      return { cap: 1, levels: [{ id: selected, running: true, textureMB: memoryMB }] };
    };
    app.levelAdapters.residentMemory = memory;
    markDropStep({ step: PLAYING });
    setAliveSource((): AliveInfo<PageMode> => ({ slug: selected, resident: `${selected} (playing) ~${Math.round(memory(60_000).levels[0]?.textureMB ?? 0)} MB`, mode }));
  } catch (error) {
    options.residency?.dispose(); // Pre-bootstrap failures have no consumers; runShardLoad disposes allocated ones first.
    if (options.recovery !== undefined) throw error; // the root returns a consumed recovery to the renderer-free title
    markBootHandledError();
    noteDropError(error);
    if (!session.fatalShown) showError(error instanceof Error ? `${error.name}: ${error.message}` : String(error), error instanceof Error ? error.stack ?? '' : '');
  }
}

async function buildSession(manifest: ShardManifest, stage: LoadStage, kit: KitPorts, session: SessionState): Promise<BuiltWorld> {
  wirePage.followBooks(); // J130: before anything this session installs reads a book
  const boot: StagedBoot = { handoff: null, items: new Map(), featTotal: undefined, skins: [],
    runtime: { world: null, step: null, play: null, interactables: [], overhead: [], objects: {}, hooks: {}, viewer: () => new THREE.Vector3(), horizonVeil: null },
    progress: { set: () => undefined, detail: () => undefined }, worldHook: (work) => work() };
  const loadPlugin = session.ownedGridHome ? () => Promise.resolve({ default: GridPageShellPlugin }) : manifest.load;
  if (loadPlugin === undefined) {
    const sequence = sessionStages({ kit, manifest, slug: manifest.slug, stage, session, boot, product: absentShardProduct(manifest.slug) });
    let next = await sequence.next();
    while (!next.done) next = await sequence.next();
    return next.value;
  }
  const scope = currentOwner();
  if (scope === null) throw new Error('Plugin boot needs a level scope');
  const product = await stage('product', () => loadManifestProduct(manifest, scope));
  const sequence = sessionStages({ kit, manifest, slug: manifest.slug, stage, session, boot, product });
  const { default: Plugin } = await stage('manifest.load', () => retried(loadPlugin));
  const plugin = new Plugin();
  const game: GameServices = { runtime: boot.runtime, shard: manifest, rows: new Map(), ...(session.residency === undefined ? {} : { residency: session.residency }), bag: {
    tab: (spec) => { const menu = boot.runtime.play?.menu; if (menu === undefined) throw new Error('Bag plugin tabs require the play host'); return menu.addTab(spec); },
    fragment: (tab, fragment) => { const menu = boot.runtime.play?.menu; if (menu === undefined) throw new Error('Bag plugin fragments require the play host'); return bagMenu(menu).fragment(tab, fragment); },
  } };
  let context: ShardContext | undefined;
  const ctx = (level: LevelContext): ShardContext => { context ??= shardContext(level, manifest, game, product); boot.context = context; return context; };
  app.levelAdapters.inputContext = (def) => {
    const child = scope.child(`input.${def.id}`); app.input.register(def, child);
    return () => child.dispose();
  };
  app.levelAdapters.debugRow = (spec) => registerLevelDebugRow(spec, manifest.slug);
  app.levelAdapters.playground = (spec) => registerPlayground(manifest.slug, spec);
  try {
    return await bootLevel(session.ownedGridHome ? gridPageShellLevel(manifest) : gridLevel(toLevelSpec(manifest, product)), {
      sequence, scope, progress: () => boot.progress,
      afterData: (spec) => { if (boot.handoff?.arrive) spec.spawn = boot.handoff.arrive; },
      dispose: () => {
        if (app.render !== null) { app.render.captureLevelResources(); app.render.hold = true; app.render.frameGate = () => false; }
      },
      hooks: {
        world: (level) => boot.worldHook(async () => { await plugin.world?.(ctx(level)); }),
        kit: async (level) => {
          ctx(level).rows.item(kit.items);
          ctx(level).rows.tool(kit.tools);
          await plugin.kit?.(ctx(level));
          boot.skins = [...(game.rows.get('skin')?.values() ?? [])] as SkinDef[];
          boot.items = game.rows.get('item') ?? new Map(); boot.featTotal = game.rows.get('feat')?.size;
        },
        play: (level) => plugin.play?.(ctx(level)),
      },
    });
  } catch (error) {
    if (error instanceof LevelLoadError) throw new ShardLoadError(error.stage, error);
    throw error;
  }
}

async function* sessionStages(ctx: SessionContext): LevelSequence<BuiltWorld> {
  const data = await dataStage(ctx);
  const level = yield 'world';
  const world = await worldStage(data, level);
  yield 'kit';
  yield 'loadout';
  const loadout = await loadoutStage(world);
  yield 'play';
  const play = await playStage(loadout);
  yield 'finish';
  return finishStage(play);
}

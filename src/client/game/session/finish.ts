import type { BuiltWorld } from './context';
import { exploreChannel } from '@wildshard/engine/app/view/exploreChannel';
import { bootMark, bootTask } from '@wildshard/engine/boot/timing';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { captureHeightfield } from '@wildshard/engine/world/Heightfield';
import { sustainedFrames } from '@wildshard/engine/core/sustainedFrames';
import { Rng } from '@wildshard/format/seededRng';
import { gridCells } from '../plugin/context';
import { initialHomeMetadataRequired } from '../grid/homeMetadata';
import { reenterGrid, reenterGridInPage, reenterShard, showGridDestination } from '../grid/pageEntry';
import type { playStage } from './play';
import type { WorkerClientGrid } from '../shardfile/clientWorker';
import { loadWorkerClient } from './data';
import { asShell } from '@wildshard/engine/app/ownership';
import { app } from '@wildshard/engine/app/runtime';
import { releaseByteCounter } from '@wildshard/engine/boot/bytes';
import { hasLateAudio, startAudioPreload, startLateAudio, type AudioBanks } from '@wildshard/engine/boot/extras';
import { macrotask } from '@wildshard/engine/boot/plan';
import { loadingStage, loadingUnits, waitFor } from '@wildshard/engine/boot/waits';
import { beginLoadingWait, finishLoadingWait } from '@wildshard/engine/boot/loadingWaits';
import { currentLoadingTimeline } from '@wildshard/engine/boot/timeline';
import { startShardPrefetch } from '@wildshard/engine/boot/shardPrefetch';
import { noteWorldFrame } from '@wildshard/engine/telemetry/runtime';
import { afterControl, reachControl, whenControl } from '@wildshard/engine/boot/prefetch';
import { idleTurn } from '@wildshard/engine/boot/idle';
import { installGpuRecovery } from '@wildshard/engine/core/GpuRecovery';
import { installWorldWatch } from '@wildshard/engine/core/worldWatch';
import { softwareRasterizer, webglRendererName, workerReadsOnPageThread } from '@wildshard/engine/core/slowGpuPacing';
import { TIER } from '@wildshard/engine/core/tier';
import { lockOn as lockState } from '@wildshard/engine/player/AimTargets';
import { programTwinsOn } from '@wildshard/engine/render/programTwins';
import { withoutOffscreenBakes } from '@wildshard/engine/render/offscreenPreparation';
import { bootRoadPrograms, liveWarmPacing, precompileLevel, queuedLinks, unbuiltObjects } from '@wildshard/engine/render/precompile';
import { textureBytes } from '@wildshard/engine/render/textureBytes';
import { beginFarCopies, farLodOn, settleFarCopies, uploadFarCopyIndices } from '@wildshard/engine/render/farLod';
import { budgetCollection, budgetCollectionEnabled, collectBeforeShaders, releaseDrawnGeometry } from '@wildshard/engine/render/memorySaver';
import { setPoseProvider } from '@wildshard/engine/ui/ReloadPrompt';
import { setOneShardZone } from '@wildshard/engine/boot/titleArrival';
import { lastEnd, registerBeforeReload } from '@wildshard/engine/boot/lastEnd';
import { shardArea } from '../grid/area';
import { primeStaticMerges } from '../grid/staticViewMerge';
import { kitBatchOn, primeBatchPrograms, primeKitBatches } from '../grid/kitBatch';
import { farBatchOn, multiDraws } from '../grid/farBatch';
import { admittedRuntimeFolder, completeManifestCache, releaseManifestTransport } from '../shardfile/runtimeFolder';
import { enterSkyClock } from './clockSettings';
import { settleEntryPrograms } from './settlePrograms';
import { prepareSpawnView } from '../shardfile/controlRefinement';
import { settleTileDrivers, settlingTiles } from '../shardfile/tileDriver';
import { observeTitlePreparation, prepareTitleFrame } from './titlePreparation';
import { observeAfterBootAudio } from './afterBootAudio';
import { installCrashCheckpoint } from './crashResume';
import { GAME_STRINGS } from '../../../shared/game/strings';
import { currentSpawnDownload, dropStoredSpawnMembers, heldSpawnMembers, retrySpawnDownload } from '../boot/spawnDownload';
import { downloadGiveUp } from '@wildshard/engine/boot/downloadGiveUp';
import { waitEntryWork } from './entryReadiness';
import { spawnViewThenNamed } from './readyFrame';
import { slowShaderGpu } from './slowGpu';
/** The grid's whole-set prefetch: the entry loads it with its common services (`entry.ts`), so it stays out of the
 *  session's static closure (its raw budget) and this import resolves at once. */
const gridPrefetch = () => import('../grid/prefetch');

/** What a grid page lends the worker client (J130). */
function workerGrid({ grid, gridLive }: Pick<Awaited<ReturnType<typeof playStage>>, 'grid' | 'gridLive'>): WorkerClientGrid | null {
  return grid === null || gridLive === null ? null : { cells: grid.assembly.cells, bindWire: wire => { gridLive.bindWire(wire); }, frame: () => gridLive.frame(), animals: () => gridLive.enteredAnimals(), roadAnimals: () => gridLive.roadAnimals(), items: () => gridLive.enteredItems(), saveLocation: () => { gridLive.saveLocation(); },
    // GO5: the server's place is the save; the hint and the loading card follow it.
    serverPlace: (instance, at) => { gridLive.serverPlace(instance, at); const cell = grid.assembly.cells.find(row => row.instance === instance); if (cell !== undefined) showGridDestination(cell.slug); },
    reenter: instance => { reenterGrid(instance); }, reenterInPage: (instance, handOver) => reenterGridInPage(instance, handOver), reshard: instance => { reenterShard(instance); }, booted: gridLive.booted };
}

/** how often the in-play warm-up asks whether an arrival's Explorer has closed, and how long it waits for one to open */
const EXPLORER_POLL_MS = 1000, EXPLORER_OPEN_MS = 30_000;
/** PL6: the boot shader step's slice (ms); the loader's text still updates well inside its 1 s. Measured at phone CPU 10x
 *  it moved nothing (warm step 2.10 -> 2.17 s, f040ca2936): one material's job overruns any such slice there, and the step
 *  is its program builds' CPU, not its painted frames. */
const BOOT_SHADER_SLICE_MS = 48;
/** PINE-FLASH: the spawn ground hold, named on the loading card while it waits; its outcome and time go in a boot mark. */
async function holdSpawnGround(grid: Awaited<ReturnType<typeof playStage>>['grid']): Promise<void> {
  if (grid === null) return;
  const timeline = currentLoadingTimeline(), at = diagnosticNow();
  const wait = beginLoadingWait('Spawn ground', { kind: 'work', step: timeline?.snapshot().current ?? null, owner: timeline?.waitOwner ?? null });
  // best-effort: a hold that throws leaves the ground to the rings in play, as before it, and never fails the load
  try { const outcome = await grid.prepareSpawnGround(); bootMark('app:spawn-ground', { outcome, ms: Math.round(diagnosticNow() - at) }); }
  catch (error: unknown) { console.warn('[grid] spawn ground hold stopped', error); bootMark('app:spawn-ground', { outcome: 'failed', ms: Math.round(diagnosticNow() - at) }); }
  finally { finishLoadingWait(wait); }
}

/** QA8: link the world's programs the spawn view did not draw before the reveal, nearest first, at the in-play pace (a few
 *  programs a frame, each link polled). Only completion or owner retirement ends this loading step. */
async function linkWorldUnderLoader(game: Awaited<ReturnType<typeof playStage>>['game'], unbuilt = false): Promise<void> {
  const scope = game.levelScope;
  // DL21: the step counts its links on the card ('World program links · 12 / 40 programs linked'), as the Shaders step
  // does: Pine's sat 5.3-5.5 s unchanged in the DL23 recordings on live 86f2590, with no wait named
  const timeline = currentLoadingTimeline(), key = timeline?.snapshot().current ?? null;
  const progress = key === null ? undefined : (done: number, total: number, detail: string): void => { timeline?.report(key, detail, done, total); };
  await waitEntryWork(scope, current => precompileLevel(game, progress, { sliceMs: 6, current, owner: scope, nearest: true, ...liveWarmPacing(), ...(unbuilt ? { arrival: unbuiltObjects(game.renderer) } : {}) }));
}

export async function finishStage(ctx: Awaited<ReturnType<typeof playStage>>): Promise<BuiltWorld> {
  const { manifest, boot, slug, loading, audioProfile, files, plan, step, audioLoad, deferredAudio, world, game, sky, player, chunk, fragileBoot, failGpuBoot, onBootContextLost, edgeDressing, boundary, water, interactables, props, disableBootGpuGuard, level, animals, getArena, crossbow, weapons, lockSys, hud, perf, audio, music, playerHealth, exploring, hands, windupWarn, resuming, arrival, menuFirst, enter, getPlayground, leakPhysics } = ctx;

  // The staged loader invokes the native play hook after buildPlay. Only a fully installed runtime can leave:
  // leaving during buildPlay disposes its kit scope before that hook runs and makes recovery fall back to title.
  const enterGrid = async (): Promise<void> => {
    if (ctx.session.ownedGridHome === true) {
      if (ctx.gridLive === null) throw new Error('Owned grid home requires its admitted live session');
      if (initialHomeMetadataRequired(ctx.session)) {
        await ctx.grid?.waitInitialHomeMetadata();
        await ctx.gridLive.enterInitialHome();
      }
    }
    if (ctx.session.recovery !== undefined) {
      if (ctx.gridLive === null) throw new Error('Recovery requires the admitted live grid');
      if (ctx.session.recovery.saved?.location.kind !== 'cell') await ctx.grid?.prepareOuterStrips();
      const pose = ctx.gridLive.resumeRecovery(ctx.session.recovery);
      player.spawn(pose.x, pose.z, pose.yaw, pose.y); player.pitch = 0;
      if (pose.road) gridCells.leave();
    }
  };
  // The initial owned home can issue its exact program inventory while kit/play
  // construct. Allocate the same page-owned composer once before that work;
  // standalone and legacy-grid keep their prior order.
  const eagerGridComposer = ctx.session.ownedGridHome === true && ctx.gridLive !== null;
  if (eagerGridComposer) { await game.prepareComposer(); game.buildComposer(); }
  if (ctx.gridLive !== null || ctx.session.recovery !== undefined) await loadingStage('home', enterGrid);
  if (ctx.gridLive !== null) {
    const grid = ctx.gridLive;
    // GPU/background own the same checkpoint port above; New game captured it before resetting and suppresses stale saves.
    // An explicit reload and a Settings reload (SR12) capture a planned reload here; only `reload` then returns to the title.
    registerBeforeReload(game.levelScope, reason => {
      if (reason === 'new-game' || reason === 'gpu' || reason === 'background') return true;
      const saved = grid.prepareRecovery('reload');
      if (saved) game.hold = true;
      return saved;
    });
  }

  // the grid's road system builds beside the loading steps (GridSession.create): in the scene before its shaders warm. Its
  // wait is the grid path's 'road' step (it was an unnamed gap after Home region, 0.46 s cold on live, round 40)
  if (ctx.grid === null) await macrotask();
  else { const grid = ctx.grid; await loadingStage('road', async () => { await macrotask(); await grid.roadLanded(); }); }
  // LD5 (J208): the server boots on its own thread beside the frame steps below; the server step adopts it. It starts
  // only once the home region has placed the player and its saves, which the server carries from the page.
  void (async () => {
    try {
      const worker = await loadWorkerClient();
      if (!game.levelScope.disposed) worker.startWorkerServerEarly({ slug: ctx.grid?.home.slug ?? slug, lone: workerGrid(ctx) === null, scope: game.levelScope });
    } catch { /* the server step imports it again and reports its failure */ }
  })();
  // R12: a standalone page's own sky clock (a painted sky, published by its runtime) is the day cycle while the level lives
  // and takes the pinned time; on the grid each entered cell registers its own (runtime shard.ts)
  if (ctx.grid === null) enterSkyClock(app, [game.levelScope], game.levelScope);
  if (!eagerGridComposer) { await game.prepareComposer(); game.buildComposer(); }
  // DL24 (J198): every body a row can bring, parked hidden after the compose, so the first frame builds its programs.
  // DF8 (`debug.programTwins`): not on a grid page, where every row draws in a region whose own rigs carry its look
  if (ctx.grid === null || !programTwinsOn()) animals.stageWarmRigs();
  // The first live late/render phases would otherwise publish the home PMREM and install its grade only after
  // shaders/firstFrame, invalidating every warmed world key. Settle the same presentation owners without a tick.
  ctx.grid?.prepareFrame();
  game.sky.prepareLayers();
  // Compile programs in batches with a visible count, then draw the first frames as a step —
  // instead of the first render() compiling ~100 programs in one stall (minutes on iOS).
  const programs = () => `${game.renderer.info.programs?.length ?? 0} programs`;
  // MF5 / NP-1: the spawn view refines under the loader (its L0 tiles, late welds and dressing reads, before control),
  // so the shaders below link the fine pieces and the reveal shows them; only what lies outside it refines in play
  // The camera is posed by the shader step below. Keep the player reference
  // for this first fence; the final readyFrame fence uses the posed camera.
  // PINE-FLASH (grid/spawnGround.ts): first the entered cell's own ground where its ring tiles are that ground (Pine), so
  // control never arrives over its far proxy; bounded, and nothing for a cell that draws its own ground (Nalati)
  budgetCollection();
  await loadingStage('spawnDetail', async () => { await holdSpawnGround(ctx.grid); await prepareSpawnView(undefined, undefined, 'player'); });
  // mini QA 2026-11-17 row 19: the shaders step and the first frames are the boot's memory peak (every texture, buffer and
  // pipeline reaches the GPU, which iOS charges to the page). The parts the store already holds leave memory first (Nine:
  // 48 parts, 106.5 MB); a later read of their files is the store's checked copy.
  bootMark('download:members-dropped', { count: dropStoredSpawnMembers(), held: heldSpawnMembers() });
  // DF10 (mini-df10e): with `debug.kitBatch` at phone Low, the kit's plain meshes draw as one batch per material from here,
  // before anything uploads their channels (and lets their CPU copies go), so the shaders step links and uploads the batches
  const kit = primeKitBatches(game.rootScene, game.levelScope, multiDraws(game.renderer));
  if (kit.batches > 0) bootMark('render:kit-batches', kit);
  // and every geometry drawn so far lets its CPU copy go after each drawing step (play waits 240 renders, which the boot
  // never reaches: Nine's phone held 88-147 MB of attribute arrays beside their GPU copies through its peak)
  // IP30: under the phone byte budget each step's uploaded batch frees its staging arrays and then its garbage, before the
  // next step decodes on top of it
  const releaseDrawn = (after: string): void => {
    bootMark('memory:geometry-released', { after, bytes: releaseDrawnGeometry(game.renderer) });
    const hinted = budgetCollection(); if (hinted > 0) bootMark('memory:budget-collection', { after, bytes: hinted });
  };
  // FR-A18: a CPU rasterizer (a software renderer name, or the shaders step measured one): the frames wait for the early
  // server, and the spawn view settles in one draw
  let cpuRaster = false;
  try {
    // LS8 (J204): the shaders step's measured cost per program decides how the first frame slices its draws
    const shadersAt = diagnosticNow(), programsBefore = game.renderer.info.programs?.length ?? 0;
    // SB32b: the step's texture uploads, which say nothing of how the GPU builds programs (slowGpu.ts)
    let uploadMs = 0;
    // MG10 (mini-ninemem10): WebKit's full collection now, before the shaders, first frames and readyFrame pile onto the
    // boot's garbage (the loading peak is the heap's high-water at that collection)
    bootMark('memory:collection-hint', { bytes: collectBeforeShaders() });
    await step('shaders', async (p) => {
      // Until the first systems step the camera stands at the origin (Nine: 127 m below the spawn's eye, at 72° not the
      // held 93°) and placed copies hold none until their first cull: one step without its draw poses the spawn view,
      // so the shaders below and firstFrame's warm turns link and draw what the player sees, not the origin's view
      bootMark('app:first-game-step-start');
      withoutOffscreenBakes(() => { game.stepFrame(); });
      bootMark('app:first-game-step-end');
      // A six-material job exceeded the loading text's one-second update
      // budget at phone CPU speed. Use the existing one-material sliced path.
      // PL6, DL23: and everything the first frame's parked warm draws (out of view, hidden alternates), so none of it
      // builds and links inside that frame
      // DL10: not paced on WebKit, even with Debug 'Early shader compile' on. Its baked list leaves these links compiled in
      // the GPU process, and one program a painted frame then only stretched the step (Nine Sim cold, 266f9ea939: issue
      // 1.2 s of a 3.0 s step) without shortening its longest frame (824 ms paced vs 908 ms unpaced, both in texture uploads)
      const firstFrame = await game.firstFrameCensus();
      await precompileLevel(game, (d, n, what) => {
        bootMark('app:shader-work-count', { done: d, total: n, detail: what });
        p.set(d, n, `${what} · ${programs()}`);
      }, { sliceMs: BOOT_SHADER_SLICE_MS, warmPost: true, drawnOnly: true, firstFrame, onStage: (phase, ms) => { if (phase === 'upload') uploadMs += ms; } });
    });
    releaseDrawn('shaders');
    if (fragileBoot && game.renderer.getContext().isContextLost()) throw new Error('WebGL context lost during shader compile');
    const shaderMs = diagnosticNow() - shadersAt, built = (game.renderer.info.programs?.length ?? 0) - programsBefore;
    const renderer = webglRendererName(game.renderer.getContext());
    const slowGpu = slowShaderGpu({ stepMs: shaderMs, uploadMs, programs: built, renderer });
    cpuRaster = slowGpu || softwareRasterizer(renderer);
    bootMark('app:first-frame-plan', { shaderMs: Math.round(shaderMs), uploadMs: Math.round(uploadMs), programs: built, narrow: slowGpu });
    // LS11 (J204): a GPU this slow composites the page in software; the card covers the world until it fades
    if (slowGpu) loading.coverCanvas(game.canvas);
    // RT3: and, on a software rasterizer only (never a real GPU: the phone stays at 2x), its frames in play are paced so
    // its read-backs leave the main thread to worker messages and input
    if (slowGpu) game.paceSlowGpu();
    // FR-A18: on a CPU rasterizer each frame step below holds the page's main thread for seconds (Nalati on Linux: first
    // frame 27 s, spawn programs 27 s), and WebKit runs the in-page server worker's reads through that thread, so its world
    // boot took 77 s behind them. In WebKit the frames wait for the early server instead: its reads run on an idle thread,
    // then the frames draw. A failed boot is still the server step's to report; a real GPU, or Chromium, never waits here.
    if (cpuRaster && workerReadsOnPageThread(navigator.userAgent)) {
      const held = diagnosticNow();
      await bootTask('app:cpu-raster-server-first', async () => { await (await loadWorkerClient()).earlyServerBooted(); });
      bootMark('app:cpu-raster-hold', { renderer, slowGpu, ms: Math.round(diagnosticNow() - held) });
    }
    await step('firstFrame', async (p) => {
      let passes = 0;
      // its units are measured seconds (J204), so the counts live in `what`, not in d / n
      await game.firstFrame((d, n, what) => {
        bootMark('app:first-frame-work-count', { done: d, total: n, detail: what });
        passes = n; p.set(d, n, `${what} · ${programs()}`);
      }, slowGpu);
      bootMark('app:first-frame-work-count', { done: passes, total: passes, detail: 'ready' });
      p.set(passes, passes, `ready · ${programs()}`);
    });
    releaseDrawn('firstFrame');
    if (fragileBoot && game.renderer.getContext().isContextLost()) throw new Error('WebGL context lost during first frame');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (fragileBoot && /WebGLShader|WebGL context lost|shaderSource/i.test(message)) failGpuBoot(message.slice(0, 120), error instanceof Error ? error.stack ?? '' : '');
    throw error;
  }
  // DF9 (mini-dfload): with `debug.farLod`, the far copies build at the loading pace from here (beside the card's waits on
  // GPU links and tiles), after the first frame's plan is measured so its timing is unchanged
  beginFarCopies();
  loading.setTextureBytes(textureBytes(game.rootScene));
  // Phone staged worlds finish their product and server work before decoding
  // the downloaded bank. The loader still waits for it before control.
  const audioAfterWorld = TIER === 'phone' && manifest.boot?.stagedWorld === true && deferredAudio === null;
  const prepareBootAudio = async (): Promise<void> => {
    // Nine Dragon phone counts and caches the same files, then decodes selected audio after the loader's peak.
    if (deferredAudio) {
      await step('audio', (p) => deferredAudio.wait(p));
      // The synth bridges the short delay. This empty bank prevents Music.prepare() from decoding the
      // same selected style again if the player taps before the deferred decode finishes.
      music.useBank({ genre: deferredAudio.style, set: 'base', slots: new Map(), stings: new Map(), log: [] });
    }
    // I7: a phone profile's boot audio past its first seconds downloads and decodes after control
    const audioPreload = deferredAudio ? null : audioLoad ?? startAudioPreload(files, chunk, audioProfile);
    if (audioPreload) {
      const banks = await step('audio', (p) => audioPreload.wait(p));
      if (banks.music) music.useBank(banks.music); // the title theme's first gesture plays the stems at once
      if (banks.profile) audio.useLevelBank(banks.profile); else audio.useSamples(banks.sfx);
    }
    const finishPlan: unknown = Reflect.get(plan, 'done');
    if (typeof finishPlan !== 'function') throw new Error('Boot plan cannot finish');
    Reflect.apply(finishPlan, plan, []); // throws unless both tracks are exactly 1
    releaseByteCounter();
  };
  if (!audioAfterWorld) await prepareBootAudio();
  if (resuming) performance.mark('wildshard.grid.entry-policy', { detail: {
    reason: ctx.session.recovery?.reason ?? 'url', saved: ctx.session.recovery?.saved !== undefined,
    continuing: ctx.continuingGridEntry, grid: ctx.grid !== null, arrival: arrival?.mode ?? 'none',
  } });
  // G325: an arrival enters at once, but its AudioContext waits for the player's first tap (`installAudioUnlock`)
  // an app switch that takes the GPU (iOS): hold the loop, restore in place or reload where the player stood (E54)
  const recoveryInstalledAt = performance.now();
  installGpuRecovery({ game, rebuild: () => { sky.rebuildEnvironment(); }, pose: () => (hud.entered ? { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw, pitch: player.pitch } : null),
    ...(ctx.gridLive === null ? {} : { beforeReload: (reason: 'gpu' | 'background') => ctx.gridLive?.prepareRecovery(reason) === true }),
    fragileBoot: () => TIER === 'phone' && performance.now() - recoveryInstalledAt < 20_000,
  });
  disableBootGpuGuard();
  // SB48 (Jake's iPhone, v0.1.43: the HUD over a black world): look at the world a few times after control; a canvas left
  // hidden comes back, a world that never draws is reported and gets the error card's RELOAD (worldWatch.ts)
  whenControl(game.levelScope, game.levelScope, () => {
    installWorldWatch({ canvas: game.canvas, get hold() { return game.hold; }, captureFrame: (w) => game.captureFrame(w),
      contextLost: () => game.renderer.getContext().isContextLost(),
      turns: () => ({ given: game.animationFrames, due: game.drawTurns }),
      playing: () => hud.entered && document.querySelector('#hud.ws-grid-revealing') === null && document.querySelector('.ws-load:not(.hide)') === null,
      detail: () => {
        const gl = game.renderer.getContext();
        return { tier: TIER, buffer: `${String(gl.drawingBufferWidth)}x${String(gl.drawingBufferHeight)}`,
          canvas: `${String(game.canvas.width)}x${String(game.canvas.height)}`, programs: game.renderer.info.programs?.length ?? 0, frame: game.frameCount, slug };
      },
      scope: game.levelScope });
  });
  if (fragileBoot) game.levelScope.unlisten(game.canvas, 'webglcontextlost', onBootContextLost);
  // CHUNK-PARAM CP3 (J522): the engine's reloads hand a one-shard page's zone in the tab; a grid page's record carries its own
  setOneShardZone(ctx.grid === null ? slug : null);
  setPoseProvider(() => (hud.entered ? { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw, pitch: player.pitch } : null)); // the Look Lab's reload prompt comes back right here (E65)
  // L15: the loader fades over the live world, not over the boot's last warm-up render (round 53: a washed-out lower
  // half, an empty minimap and the title ghost under the HUD for ~0.3 s): the loop starts first, and the loader leaves once
  // two frames have drawn and the minimap's baked map has decoded
  app.setState(hud.entered ? 'play' : 'title');
  // MF5 / NP-4: the first world frame is a named step, never a gap after Audio. FC2: nothing free-runs behind the loader;
  // the loop starts parked behind its gate and the first world frame is ONE hidden frame under the opaque card
  // What changed in view since the shaders step (the steps between move the clock, culling and the spawn ring) links
  // sliced under the card before the hidden frame draws it: before the posed shaders step, 14 programs linked inside this
  // frame.
  await loadingStage('worldFrame', async () => {
    game.start(); game.stepFrame();
    // DF10 (mini-df10b): with `debug.staticMerge` on, the views' merged meshes exist before this precompile, so their own
    // program variants link under the card (swept after control, an iPhone 13's first boot linked ~11 in play)
    await primeStaticMerges();
    // DW3/DF8: with `debug.bootRoadPrograms` the whole inventory links here, under the card (undrawn materials, families and
    // the entered roots' road variants), so the first seconds of play link nothing
    const wholeInventory = bootRoadPrograms();
    await precompileLevel(game, undefined, { sliceMs: BOOT_SHADER_SLICE_MS, ...wholeInventory ? {} : { drawnOnly: true }, turns: game.warmTurnYaws() });
    if (wholeInventory) await game.warmDeferredEntryRoots(() => !game.levelScope.disposed && !game.levelScope.disposing, undefined, true);
    // DF8 (mini-dwfps2): and the far ring's proxy and band programs, which the outer ring would link in play
    if (wholeInventory) await ctx.grid?.warmFarRingPrograms((roots, current) => game.warmRootsNow(roots, current), () => !game.levelScope.disposed && !game.levelScope.disposing);
    game.hiddenFrame();
    noteWorldFrame();
    bootMark('app:first-game-frame-submitted');
    game.levelScope.raf(() => { bootMark('app:first-game-frame-opportunity'); });
  });
  releaseDrawn('worldFrame');
  // FC2 (L15): the ready frame is one more hidden frame; the minimap's baked map decodes beside it
  // MF5 + FC2: what the hidden frames registered in the spawn view (the ring's L0 tiles the first draw asks for) refines
  // under the card too, before the reveal; the minimap's baked map decodes beside it
  await loadingStage('readyFrame', async () => {
    // the hidden frame runs inside the open fence, so the tile driver attaches the spawn ring's fine tiles and they refine now
    // DL17: the horizon paintings (world.ts started them at world build) are drawn at control too; a standalone whole-cell
    // level (`ring: 'cell'`) attaches every tile before control, so its fence takes every job, not only those within 221 m
    // (Pine's 7 jobs at 230 m and beyond waited for control). The grid keeps its reach: its fence also holds the cells
    // round the home, whose queues run in play (an unbounded grid fence never closed)
    const wholeLevel = ctx.grid === null && ctx.product.shardfile.ring === 'cell';
    // DL21: the step names what it waits on, so the card never shows only its reads tally ('Reading 8 files · 0.0 MB' held
    // Nine's cold step 27 for 3.5 s in the DL23 recording with no read in flight). The three run together and fail as one
    // (spawnViewThenNamed); the spawn view counts its fence jobs from its opening, the tile settle included ('Spawn view ·
    // n of m · MB'), and the minimap and horizon are named after it, while they still run.
    // LS8 (J204): its three jobs count as each completes (2.0 s of SwiftShader at 4x CPU otherwise moved nothing)
    const readyUnits = loadingUnits('Ready jobs', 3);
    let readyDone = 0;
    const counted = <T>(job: Promise<T>): Promise<T> => job.then(value => { readyUnits(++readyDone); return value; });
    // QA row 27: Jake's Nine paste had 4.6 s of readyFrame with no entry before 'wait:Minimap': the spawn view's fence and
    // its tile settle, which the card names but the boot timeline did not; it is a named wait there too now
    await spawnViewThenNamed(counted(bootTask('wait:Spawn view', () => prepareSpawnView(wholeLevel ? Infinity : undefined, () => settleTileDrivers(() => { game.hiddenFrame(); releaseDrawnGeometry(game.renderer); budgetCollection(); }), 'camera', settlingTiles))),
      // NB3: their own spans from their start too (the card names them only once the spawn view ends)
      [['Minimap', counted(bootTask('app:ready-minimap', () => waitEntryWork(game.levelScope, () => ctx.minimap.prepare())))],
        ['Horizon paintings', counted(bootTask('app:ready-horizon', () => edgeDressing.horizonReady))]]);
  });
  releaseDrawn('readyFrame');
  // P0: the phone's spawn programs settle while loading still covers the reveal.
  // Undrawn world programs remain in the sliced after-control warm-up below.
  // A boot that lands on the title reveals nothing yet: it draws no frame before ENTER (CI's 0.3 fps runner spent ~70 s
  // of Nine's 150 s title budget on these 20+ frames), and the title's own warm-up below links the world meanwhile.
  const entersAtReveal = hud.entered || arrival?.mode === 'enter' || arrival?.mode === 'arena' || ctx.continuingGridEntry;
  // DL17, DL21: the server's boot (the world's door on a world build), adopted by the server step below. STAGING-BUGBASH SB47:
  // that step mostly waited on the door's welcome (959 of 1479 ms idle at 4x CPU), so a phone starts it beside the world
  // program links and the step waits only for what is left (headless WebKit 4x: links 2.0 s, server 1.7 s; Jake's iPhone
  // 5.1 s and 3.5 s). A failure is still the server step's: it awaits the same promise.
  let serverLaunch: Promise<void> | null = null;
  const launchServer = (): Promise<void> => { serverLaunch ??= loadWorkerClient().then(worker => worker.launchWorkerClient({ ...(TIER === 'phone' && entersAtReveal ? { linkBodies: () => linkWorldUnderLoader(game, true) } : {}), slug: ctx.grid?.home.slug ?? slug, player, physics: world.physics, scene: game.rootScene, animals, warmRoad: roots => (async () => { try { await game.warmExteriorRoots(game.levelScope, roots, () => !game.levelScope.disposed && !game.levelScope.disposing); } catch (error: unknown) { console.warn('[other players] road variant warm-up stopped', error); } })(), weapons, health: playerHealth, died: ctx.serverDied, hurt: ctx.serverHurt, items: ctx.grid === null ? ctx.product.shardfile.items.rows : [], dims: kind => { const species = app.species.get(kind), variant = species?.variants[0]; return variant === undefined ? null : species?.build(variant, new Rng(1)).dims ?? null; }, tools: () => app.equipment?.tools ?? [], day: () => app.dayCycle, grid: workerGrid(ctx), scope: game.levelScope, system: spec => { app.addSystem(spec, game.levelScope); } })); return serverLaunch; };
  if (TIER === 'phone' && entersAtReveal) {
    // FC2: no world frames under the loader; the spawn view warms with counted offscreen draws (settlePrograms.ts)
    await loadingStage('spawnPrograms', () => settleEntryPrograms(game, cpuRaster));
    releaseDrawn('spawnPrograms');
    // QA8: on WebKit every compile runs in the GPU process, and a frame queues behind it: the ~17 world programs the
    // spawn view does not draw (Driftwood's off-screen graph materials, the loot coin) linked one a frame in play cost
    // an iPhone ~8 s at 7-11 fps (366 ms frames) right after PLAY. They link here, under the loader, paced the same way
    // and capped; what the cap leaves still links in play (warmRest).
    if (queuedLinks()) {
      void launchServer().catch(() => undefined);
      await loadingStage('worldPrograms', () => linkWorldUnderLoader(game)); releaseDrawn('worldPrograms');
    }
  }
  // DF10 (mini-dfload): with `debug.kitBatch` or `debug.farBatch`, every batch's programs link here with their road variants
  // (one per page environment): a batch is on the page scene, outside the entered roots whose road warm-ups cover the rest
  if (kitBatchOn() || farBatchOn()) {
    await loadingStage('batchPrograms', async () => {
      const current = (): boolean => !game.levelScope.disposed && !game.levelScope.disposing;
      const at = diagnosticNow(), batches = await primeBatchPrograms(game.rootScene, roots => game.warmRootsNow(roots, current));
      bootMark('render:batch-programs', { count: batches, ms: Math.round(diagnosticNow() - at) });
    });
  }
  // DF9 (mini-dfload): and what is left builds here, before control: on the iPhone 13 the far copies built for 5.7 s after
  // control (the dock's long frames and full collections); a wide mesh no loading frame drew is captured here too
  if (farLodOn()) {
    await loadingStage('farCopies', async () => {
      let units: ((done: number) => void) | undefined;
      const settled = await settleFarCopies({ scene: game.rootScene, progress: (done, total) => { units ??= loadingUnits('Far copies', total); units(done); } });
      bootMark('render:far-copies', { ms: Math.round(settled.ms), built: settled.built, left: settled.left, captured: settled.captured });
      const current = (): boolean => !game.levelScope.disposed && !game.levelScope.disposing;
      const at = diagnosticNow();
      const uploaded = await uploadFarCopyIndices(game.renderer, game.rootScene, game.camera, game.composer.inputBuffer, current, macrotask);
      bootMark('render:far-copy-uploads', { ms: Math.round(diagnosticNow() - at), ...uploaded });
    });
  }
  // DL11: setup overlapped the spawn download; control still waits for the whole set
  // FM6 modes 36 and 44: a part out of its reads refuses the job (a broken or unreachable pack). The load runs the same download
  // again once at once (the fault may have passed, as a single read's reload retry does); refused again, it waits on the card's
  // RETRY and the download-failed page, then runs it again: never the startup refusal. A cancel is no refusal.
  let rerun = false;
  for (let spawn = currentSpawnDownload(); spawn !== undefined && !spawn.snapshot().complete;) {
    try { await waitFor('Spawn download', spawn.ready, 'file'); break; } catch (failure) {
      if (spawn.snapshot().error === null || (failure instanceof DOMException && failure.name === 'AbortError')) throw failure;
      if (rerun) {
        const given = downloadGiveUp(), { awaitContentRetry, ContentReadError } = await import('@wildshard/engine/boot/contentRead');
        await awaitContentRetry(new ContentReadError(given?.detail ?? spawn.snapshot().error ?? 'spawn download', 'the download stopped', failure, false,
          { ...given?.status === undefined || given.status === null ? {} : { status: given.status }, broken: given !== null && given.status !== null && given.status < 400 }));
      }
      rerun = true;
      const next = retrySpawnDownload();
      if (next === undefined) throw failure; // nothing to run again: never control without the whole set
      spawn = next;
    }
  }
  // DL17, DL21: the server boots under the card, a counted line on it, so its reads land before control and the player's first
  // press reaches a server that is up. Before the flip this moves only J130's row.
  try {
    await loadingStage('server', launchServer);
  } catch (error) {
    plan.fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
  // QA row 29: the canvas still held readyFrame's view from the authored spawn; draw it again from the place the server's
  // first owner block put the player (clientWorker.ts), so the first revealed frame is already there
  game.hiddenFrame();
  budgetCollection();
  if (audioAfterWorld) await prepareBootAudio();
  // Let first-row activation finish before the recovery menu parks the page.
  // Its captured resume state is play, after the loader's app transition above.
  if (resuming && !ctx.continuingGridEntry) hud.setPaused(true); // Graphics recovery needs RESUME; a planned update retains the original tap.
  const readyFrameGate = game.frameGate, loadingFrameGate = (): boolean => false;
  if (loading.holdRequested) game.frameGate = loadingFrameGate;
  try { await loading.done(); }
  finally { if (game.frameGate === loadingFrameGate) game.frameGate = readyFrameGate; }
  if (level === undefined) app.events.emit('level.loaded', { id: slug });
  // DL20: the download's outcome reaches telemetry from its own settle (reportSpawnOutcomes, session.ts), failures too
  // js-heap H6: the boot has built everything its admitted product's transport fed (clientAssets.ts `releaseAll`)
  admittedRuntimeFolder(slug)?.assets.releaseAll();
  // and a solo page's own admission (its manifest's); an offline cache check never holds the boot
  void releaseManifestTransport(manifest);
  // the programs the first frame did not draw, a few a frame in play (the Shaders step built only the drawn ones)
  const levelScope = game.levelScope;
  // A page that opens straight into the Explorer walks no world: the cards draw first, and the world's undrawn
  // programs wait until the Explorer closes. On a software GPU (CI's SwiftShader, no parallel compile) each of them was a
  // synchronous link inside a frame, and the warm-up held Pine's first card past the smoke's deadline (127 s of 180).
  const afterExplorer = async (): Promise<void> => {
    // a title arrival (Explore ▸ another shard) or the page's own ?explore= route (ctx.startExplore)
    if (arrival?.mode !== 'explore' && ctx.startExplore === undefined) return;
    let seen = false;
    for (let waited = 0; !levelScope.disposed; waited += EXPLORER_POLL_MS) {
      if (exploring()) seen = true;
      else if (seen || waited >= EXPLORER_OPEN_MS) return; // closed, or never opened
      await new Promise<void>((resolve) => { levelScope.timeout(EXPLORER_POLL_MS, resolve); });
    }
  };
  const warmRest = async (): Promise<void> => {
    await afterExplorer();
    // The title's readiness includes these shaders, so they cannot depend on
    // control or live game draws. Keep the original paint-paced compilation;
    // only the separate afterControl download/speculation path idles.
    const current = (): boolean => !levelScope.disposed && !levelScope.disposing;
    // what the boot left (shaders: drawnOnly) links nearest-first under the live slice budget
    try {
      await precompileLevel(game, undefined, { sliceMs: 6, current, nearest: true, ...liveWarmPacing() });
      await game.warmDeferredEntryRoots(current);
    }
    catch (error: unknown) {
      if (!levelScope.disposed) console.warn('[shaders] the in-play warm-up stopped:', error);
      throw error;
    }
  };
  const titleShaders = warmRest();
  const exploreApp = exploreChannel();
  if (!exploreApp && (arrival?.mode === 'enter' || arrival?.mode === 'arena' || ctx.continuingGridEntry || (arrival === null && loading.playRequested))) enter();
  else if (arrival?.mode === 'explore') hud.startExplore(); // import the viewer only after shader compilation and the loader's peak
  if (arrival?.mode === 'arena') hud.enterArenaNow();
  if (ctx.gridLive === null) installCrashCheckpoint(game.levelScope, manifest.slug, () => hud.entered && !world.freeCamera && !world.tour.active && !exploring()
    ? { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw, pitch: player.pitch } : null);
  if (ctx.session.crashResume !== undefined || (ctx.continuingGridEntry && lastEnd().kind === 'unexpected')) hud.toast(GAME_STRINGS.grid.shardEnded(manifest.name));
  const useBanks = (banks: AudioBanks): void => {
    if (levelScope.disposed || levelScope.disposing) return;
    if (banks.music) music.useBank(banks.music);
    if (banks.profile) audio.useLevelBank(banks.profile); else audio.useSamples(banks.sfx);
  };
  const decodeAfterBoot = async (): Promise<void> => {
    try {
      if (deferredAudio) useBanks(await deferredAudio.decode());
      // DF11: give WebKit an idle turn for the hint and keep it ahead of the next decode.
      const collect = budgetCollectionEnabled();
      if (collect && !await idleTurn(levelScope)) return;
      if (levelScope.disposed || levelScope.disposing) return;
      if (collect) budgetCollection();
      const late = startLateAudio(files);
      if (late) useBanks(await late);
    } catch (error) {
      console.info(`[audio] deferred level decode: ${error instanceof Error ? error.message : String(error)} — the synth plays`);
    }
  };
  // E183: while the title idles, draw the world's first frame once under the title art. The
  // first frame after the title paid every first-time cost at once — Pine Hollow's four elites built, the cover filled,
  // textures that arrived after the boot uploaded: EXPLORE WORLD's first tap stalled ~1.3 s at 4× CPU (and ENTER WORLD's
  // first frame the same). A return from the background already draws such a frame on the title (Game.start).
  const titleFrame = menuFirst ? prepareTitleFrame({
    later: (ms, run) => { levelScope.timeout(ms, run); }, next: run => { levelScope.raf(run); },
    onDispose: run => { levelScope.onDispose(run); }, disposed: () => levelScope.disposed,
    skip: () => hud.entered || exploring(), frame: () => game.frameCount, prime: () => { game.hiddenFrame(); },
  }) : Promise.resolve();
  levelScope.onDispose(app.debug.scopedExpose('titlePreparation', observeTitlePreparation(titleShaders, titleFrame)));
  // QA 11-25 row 72: the memory meter waits for the after-control audio before its control read (measure.mjs).
  const afterBootAudio = observeAfterBootAudio();
  levelScope.onDispose(app.debug.scopedExpose('afterBootAudio', afterBootAudio));
  const handle = { ...world, get physics() { return world.physics; }, boundary, water, streams: edgeDressing.streams, hands, props, animals, interactables, crossbow, hud, audio, music, lockSys, lockState, weapons, get arena() { return getArena(); }, playground: getPlayground, ...boot.runtime.objects };
  // O18: what came from the world and the runtime's objects reads through, each time: a copy taken at boot kept the home's
  // first visit (on the grid, its whole world) after that visit retired. The runtime's objects still win, as spread last.
  const objects = boot.runtime.objects, fixed = new Set(['physics', 'boundary', 'water', 'streams', 'hands', 'props', 'animals', 'interactables', 'crossbow',
    'hud', 'audio', 'music', 'lockSys', 'lockState', 'weapons', 'arena', 'playground']);
  // A harness write (a capture's `freeCamera = true`) lands on the probe itself, as it did on the copy; reads stay live.
  const live = (key: string, from: object): void => { Object.defineProperty(handle, key, { get: (): unknown => Reflect.get(from, key),
    set: (value: unknown): void => { Object.defineProperty(handle, key, { value, writable: true, enumerable: true, configurable: true }); }, enumerable: true, configurable: true }); };
  for (const key of Object.keys(world)) if (!fixed.has(key) && !Object.hasOwn(objects, key)) live(key, world);
  for (const key of Object.keys(objects)) live(key, objects);
  app.audio = audio;
  game.retainKitResources();
  ctx.session.residency?.bindComposer(game, game.engineScope, TIER);
  game.captureLevelResources();
  game.levelScope.onDispose(() => { windupWarn?.dispose(); weapons.setEnabled(false); boot.runtime.hooks.dispose?.(); audio.unloadLevel(); });
  const grid = ctx.grid;
  // The probe describes the built world. Load it here, before publishing
  // control, so the session's initial graph does not carry its diagnostics.
  const { installProbe } = await import('@wildshard/engine/debug/probe');
  if (levelScope.disposed || levelScope.disposing) throw new Error('World disposed before probe installation');
  installProbe(handle, { leakPhysics, health: () => playerHealth.attributes.health, quest: () => ({ adventure: boot.runtime.hooks.adventureFlags?.() ?? [], quest: boot.runtime.hooks.questFlags?.() ?? [] }),
    // T2E-1b: a grid page's area is the cell the player is in, not the shell
    area: () => grid === null ? shardArea(slug, app.debug.snapshot()['shardfile'], boot.runtime.hooks.questFlags?.() ?? []) : grid.area() });
  // SHARD-SOURCE AP5 (J347): a DEVSERVER page carries the dev hook sharddev's `watch` page script drives; a production
  // build's define makes this `false` in this module, so the import and its chunk go (src/scripts/check-devserver.mjs checks;
  // DEVSERVER imported from grid/menu did not fold across modules and kept the chunk).
  if (typeof __DEVSERVER__ === 'boolean' && __DEVSERVER__) void import('../devScene/hook').then(dev => dev.installDevHook({ scope: game.levelScope, scene: game.rootScene, physics: () => world.physics,
    look: () => game.look, server: () => window.__workerClientDevColliders ?? null, serverGround: () => window.__workerClientDevGround ?? null,
    restart: () => window.__workerClientDevRestart ?? null, quests: () => window.__shardfileDevQuests ?? null,
    player: () => world.player, terrainField: captureHeightfield, watchFrames: fn => game.watchFrames(fn) }))
    .catch((cause: unknown) => { console.error('[devScene]', cause); });
  ctx.startExplore?.();
  document.dispatchEvent(new Event('ws:ready')); // booted to the title
  const completeOfflineCopy = async (): Promise<void> => {
    try { await completeManifestCache(manifest, levelScope, ctx.product); }
    catch (error: unknown) { if (!levelScope.disposed && !levelScope.disposing) console.info('[cache] deferred offline copy', error); }
  };
  const backgroundDownloads = async (): Promise<void> => {
    // The manifest is the complete automatic entry read set. In-play demand
    // streams its own files; the old whole-product copy/ring must not race it.
    if (currentSpawnDownload() !== undefined) return;
    if (!await idleTurn(levelScope)) return;
    void completeOfflineCopy();
    if (!await idleTurn(levelScope)) return;
    if (ctx.grid !== null) {
      const { gridPrefetchOrder, startGridPrefetch } = await gridPrefetch();
      startGridPrefetch(gridPrefetchOrder(ctx.grid.assembly, player.position), gridPrefetchOrder(ctx.grid.assembly, player.position, 'phone'));
    }
    // Native grids already prefetch their phone ring through verified product packs.
    if (ctx.grid === null) asShell(() => { startShardPrefetch(manifest); });
  };
  afterControl(game.levelScope, run => { game.onLate(run, 'game.boot.background'); },
    () => (exploreApp ? exploring() : hud.entered && !hud.paused) && !app.clock.paused && game.frameGate(), () => {
      document.dispatchEvent(new Event('ws:control-ready'));
      sustainedFrames.start(diagnosticNow()); // QA row 31: the sustained fps window opens at control
      reachControl(game.levelScope);
      if (deferredAudio || hasLateAudio(files)) void afterBootAudio.start(decodeAfterBoot);
      void backgroundDownloads();
    });


  const levelWorld: BuiltWorld = { scene: game.rootScene, dispose: () => {
    weapons.setEnabled(false); perf.setActive(false); audio.unloadLevel();
  } };
  game.levelScope.onDispose(levelWorld.dispose);
  return levelWorld;
}

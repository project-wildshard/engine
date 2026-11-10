// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '@wildshard/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-unassigned-import -- evaluated for its effect: the app identity is installed before any other module body runs (E414)
import './identity';
import { findTitleManifest, installTitleManifests, readTitleRows, unloadedTitleRow, withCatalogueHeads } from '@wildshard/engine/game/shard/titleList';
import { installInlineCatalogue } from '@wildshard/engine/game/grid/catalogueSlot';
import { installOfflineDownload } from '@wildshard/engine/ui/offlineDownload';
import { startPageServices } from './pageServices';
import { persistHomeScreen, saves } from '@wildshard/engine/saves/runtime';
import { definePageSaveKeys } from '@wildshard/engine/game/pageSaveKeys';
import { waitFor } from '@wildshard/engine/boot/waits';
import { runtimePacksOn } from '@wildshard/engine/boot/loadingPacks';
import { preloadModuleFiles, readModuleFiles } from '@wildshard/engine/boot/download';
import {prepareBootImports} from './bootDownloads';
/**
 * The page's module entry. Everything the game imports statically is evaluated in ONE task when a module graph
 * runs: three.js plus the ~150 game modules at once was a 115–157 ms long task at 4× CPU before the first boot step
 * (project/archive/2026-09-22-load-perf.md, "longest main-thread task ≤ 100 ms"). Importing three.js first, in its own task, leaves
 * the game's own graph (src/client/app/main.ts) to evaluate against a three that already ran — two tasks under the line. The
 * title shell is already painted from index.html, so nothing waits on this but the boot itself.
 *
 * Both imports can fail before the error modal is armed (main.ts arms it): a chunk the host no longer serves, a network
 * gone mid-boot. src/client/engine/boot/stuck.ts watches the promise so that never leaves a frozen loader (E144).
 *
 * MF3 (FOUNDATIONS): no import is retried in the page (WebKit keeps a failed module URL errored, so a retry in the same
 * document only adds 0.8 + 2.5 s before the same failure); a failed import rejects `entered`, and guardBoot reloads once.
 */
import { startLowPowerProbe } from '@wildshard/engine/boot/lowPower';
import { guardBoot } from '@wildshard/engine/boot/stuck';
import { progressOfCard, stuckMessage, watchStuckStep } from '@wildshard/engine/boot/stuckStep';
import { startShellClock, waitForLoadingStyles } from '@wildshard/engine/boot/shell';
import { inspectPreviousBoot, previousBootLine, previousBootLevel } from '@wildshard/engine/boot/bootTrace';
import { Scope } from '@wildshard/engine/app/scope';
import { bootRoute, onlineTitleFirst } from './bootRoute';
import { pendingTitleArrival } from '@wildshard/engine/boot/titleArrival';
import { lastEnd } from '@wildshard/engine/boot/lastEnd';
import { consumeCrashResume, type CrashResume } from '@wildshard/engine/game/session/crashResume';
import { bootAwait, bootMark, bootTask, bootTiming, endBootOperation } from '@wildshard/engine/boot/timing';


declare const __BUILD_ID__: string;
const earlyTiming = bootTiming();
if (earlyTiming !== undefined) {
  earlyTiming.build = __BUILD_ID__;
  for (const row of earlyTiming.entries) row.build = __BUILD_ID__;
}
bootMark('app:entry-body');
endBootOperation('app:document-and-module-graph');
bootTiming()?.begin('app:entry-and-session-preparation');
const entryScope = new Scope('entry');
let crashResume: CrashResume | null = null;
let selectedImages: Scope | undefined;
const task = (): Promise<void> => new Promise((resolve) => { entryScope.timeout(0, resolve); });
/** The plain home URL paints only the title. No renderer, world, or Three.js is imported until a shard is chosen. */
// RL3: the static module graph has arrived and run; index.html's 12 s self-reload stands down (only a hung module
// fetch, which never gets here, reloads by itself; anything after this is guardBoot's)
document.documentElement.dataset['booted'] = '';
startPageServices();
// C3: the build's catalogue, inlined in this document: no read before the first paint.
installInlineCatalogue(document);
const titleRows = withCatalogueHeads(readTitleRows(document));
installTitleManifests(titleRows);
// G727 / I9: Settings' "Download everything"; the prefetch loads only when the player opens or presses it
installOfflineDownload({
  size: async owner => (await import('@wildshard/engine/game/grid/prefetch')).remainingDownloadBytes(owner),
  start: async (owner, progress) => (await import('@wildshard/engine/game/grid/prefetch')).downloadEverything(owner, progress),
});
persistHomeScreen();
definePageSaveKeys(saves);
const search = new URLSearchParams(location.search);
// Jake (11-10): Low Power Mode for the card's tier line and Copy diagnostics, from this document's first second of rAF;
// a page that opens without a shard is the idle title, whose reading the tab keeps (boot/lowPower.ts)
startLowPowerProbe(search.get('chunk') === null);
// A13 (meta MMO-FAILURE-MODES-PLAN): Settings ▸ Developer ▸ Failure screens asks by event. Only a Developer page (`<html data-dev>`,
// src/client/engine/core/devMode.ts) answers, and only then is the prototype module downloaded: the worker never precaches it
// (scripts/app-build/serviceWorker.ts), so no player loads or sees it. Developer off closes an open screen.
entryScope.listen(document, 'ws:failscreen', event => {
  if (!Object.hasOwn(document.documentElement.dataset, 'dev')) return;
  const id = event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : 'gallery';
  void (async (): Promise<void> => {
    try { const screens = await import('./failScreens'); if (Object.hasOwn(document.documentElement.dataset, 'dev')) screens.showFailScreen(id); } catch (error) { console.warn('[failScreens] did not load', error); }
  })();
});
// Do not depend on the sibling sw.ts module finishing first; both entry points share the same consumed record.
inspectPreviousBoot();
// Safari may reload the same document after WebContent dies. Keep that automatic retry on the
// renderer-free title until the player chooses a shard again.
/** SR4: how long a boot after an unexpected grid end waits on the server's site documents before it trusts its own place. */
const SERVER_SITES_MS = 2000;
/** The server's grid site documents; undefined when IndexedDB refuses or does not answer in time. */
function serverSites(): Promise<readonly { readonly site: string | null | undefined }[] | undefined> {
  const read = import('@wildshard/engine/saves/indexed').then(indexed => indexed.readServerSites());
  const late = new Promise<undefined>(resolve => { entryScope.timeout(SERVER_SITES_MS, () => { resolve(undefined); }); });
  return Promise.race([read, late]).catch(() => undefined);
}
async function enterPage(): Promise<unknown> {
  const requested = search.get('chunk');
  // An embedded author product has its own admission. A game URL must name a
  // listed world before any discovery, tables or renderer can be prepared.
  if (requested !== null && document.getElementById('ws-shardfile') === null && findTitleManifest(requested) === undefined) {
    document.documentElement.classList.add('title-first');
    return showPageTitle('This world is not listed. Choose a world from the list.');
  }
  await waitFor('Startup stylesheets', waitForLoadingStyles(entryScope), 'file');
  const { consumeGridRecovery, gridRecoveryRefused, pageGridRecovery, pendingGridEntry } = await bootTask('app:page-entry-import', () => import('@wildshard/engine/game/grid/pageEntry'));
  // QA row 16 (GO1): an online level seats a body the world sees, so only a tap enters one. Crash resume is the solo build's.
  const online = (globalThis as { __WS_WORLD__?: unknown }).__WS_WORLD__ !== undefined;
  const tapped = requested !== null && (pendingTitleArrival(requested) !== null || pendingGridEntry(requested));
  if (document.getElementById('ws-shardfile') === null && onlineTitleFirst(search, online, tapped)) {
    history.replaceState(history.state, '', new URL('/', location.origin));
    document.documentElement.classList.add('title-first');
    return showPageTitle();
  }
  const end = lastEnd();
  const named = search.get('chunk');
  crashResume = !online && (named === null || [end.slug].includes(named)) && !search.has('explore') ? consumeCrashResume(end, titleRows) : null;
  // SR4: after an unexpected grid end, the page's place is checked against where the server's durable continuation stands.
  // A failed or slow read keeps the page's own place, as before.
  const server = end.kind === 'unexpected' && end.mode === 'grid' ? await bootTask('app:grid-server-site', serverSites) : undefined;
  const recovery = consumeGridRecovery({ unexpected: end.kind === 'unexpected', previous: end, search, ...(server === undefined ? {} : { server }) });
  if (recovery !== null || crashResume !== null) {
    search.set('chunk', recovery?.slug ?? crashResume?.slug ?? '');
    if (recovery !== null) search.set('glreload', '1');
    search.delete('at');
    const url = new URL(location.pathname, location.origin); url.search = search.toString();
    history.replaceState(history.state, '', url);
    document.documentElement.classList.remove('title-first');
  }
  const route = recovery !== null || crashResume !== null ? { rescue: false, titleOnly: false } : gridRecoveryRefused() ? { rescue: true, titleOnly: true } : bootRoute(search, { line: previousBootLine(), level: previousBootLevel(), reload: end.reload === true });
  const rescueBoot = route.rescue;
  const titleOnly = route.titleOnly;
  if (rescueBoot) {
    history.replaceState(history.state, '', new URL('/', location.origin));
  }
  if (titleOnly) {
    // Environment harness flags do not select a level; retire the first-paint loader too.
    document.documentElement.classList.add('title-first');
  }

  /** resolves once the title or the selected shard's entry has been evaluated */
  return (gridRecoveryRefused() || (titleOnly && document.getElementById('ws-shardfile') === null)) ? showPageTitle() : (async () => {
    // DL21 (E526): the static card runs its clock from the tap and names the code wait until Loading adopts it.
    const chunk = search.get('chunk'); if (chunk !== null) startShellClock(entryScope, chunk);
    const tables = prepareBootImports(bootTask('app:tables-import-and-prepare', () => import('./assetTables').then(module => module.prepareAssetTables())));
    try {
      const [tier, menu, spawn] = await bootTask('app:tier-menu-download-imports', () => Promise.all([import('@wildshard/engine/core/tier'),
        import('@wildshard/engine/game/grid/menu'), import('@wildshard/engine/game/boot/spawnDownload')]));
      await tier.initializeTier();
      const slug = search.get('chunk');
      if (typeof slug === 'string') {
        const mode = menu.gridMode(menu.DEVSERVER), flow = pageGridRecovery() !== null || pendingGridEntry(slug) ? 'grid' : 'client';
        spawn.setSpawnPacks(runtimePacksOn());
        // LD2 (J208): a Start read this download holds (selected discovery behind the warm check) is named from the tap
        spawn.observeSpawnHolds((held, path) => waitFor('Spawn download', held, 'file', `spawn-download:${path}`));
        const job = spawn.startSpawnDownload(slug, flow, tier.TIER, `${Number(mode.developer)}${Number(mode.devserver)}${Number(mode.nineDragon)}`);
        const card = document.querySelector<HTMLElement>('.ws-load');
        if (job !== null && card !== null) {
          const stop = spawn.paintSpawnDownload(job, card);
          void job.ready.then(stop, stop);
        }
      }
    } catch (error) { return tables.refuse(error); }
    await tables.ready();
    await bootTask('app:three-import', () => import('three'));
    await bootTask('app:yield-before-main', task);
    return bootTask('app:main-import', () => import('./main'));
  })();
}
async function showPageTitle(refusal = ''): Promise<void> {
  const [{ showStartTitle }, { buildTitleMenu, installGridTitle }, { travel }] = await Promise.all([import('@wildshard/engine/ui/StartTitle'), import('@wildshard/engine/game/mainMenu'), import('@wildshard/engine/game/travel/travel')]);
  // SF21a: a tap or validated recovery selects a grid; unrecorded process loss returns to title
  const grid = installGridTitle();
  // the composition root wires the game's main menu (over its shard deck) into the engine's title (E405)
  showStartTitle(({ settings, notice }) => {
    const lines = [refusal, notice ?? '', grid.note].filter((line) => line !== '').join('\n');
    return buildTitleMenu({
      active: null,
      onEnter: (card) => { travel({ to: card.slug, mode: 'enter' }); },
      onExplore: (card) => { travel({ to: card.slug, mode: 'explore' }); },
      onGrid: grid.onGrid,
      ...(grid.screen === undefined ? {} : { screen: grid.screen }),
      // Settings needs common inventory and level predicates, without booting a renderer.
      onSettings: () => { void (async () => { const { openTitleSettings } = await import('./titleSettings'); await openTitleSettings(settings); })(); },
      ...(lines === '' ? {} : { notice: lines }),
    });
  });
  // DL10 (Debug 'Early shader compile', default off): after the title's first frames, one trivial shader link starts the
  // GPU process's compiler, so a cold entry's first program does not pay its 1-1.4 s start-up
  void (async () => { const { warmShaderCompiler } = await import('@wildshard/engine/boot/earlyPrograms'); warmShaderCompiler(entryScope); })();
}

export const entered: Promise<unknown> = enterPage();
guardBoot(entered);

/** Composition root: select authored content and inject reusable kit recipes. */
export async function start(): Promise<void> {
  // DL21: a start whose card stops moving (step, setup share, bytes) names its step after a bounded wait instead of
  // leaving a dead card; the fatal modal's RELOAD HERE is the retry (src/client/engine/boot/stuckStep.ts)
  const card = (): HTMLElement | null => document.querySelector<HTMLElement>('.ws-load');
  const started = startSelected();
  watchStuckStep(started, {
    progress: () => progressOfCard(card()),
    every: (ms, run) => { const timer = entryScope.interval(ms, run); return () => { entryScope.cancelTimer(timer); }; },
    stalled: (step, stuckMs) => { void (async () => { (await import('@wildshard/engine/ui/ErrorModal')).showError(stuckMessage(step, { stuckMs })); })(); },
  });
  try { await started; }
  catch (error) {
    const { pageGridRecovery, clearGridRecovery } = await import('@wildshard/engine/game/grid/pageEntry');
    if (pageGridRecovery() === null) {
      // Admission can refuse before startSession installs its fatal-load boundary. main starts asynchronously;
      // paint the same fatal card here, naming the step it died on, instead of leaving a rejected boot behind the loader.
      const { showError } = await import('@wildshard/engine/ui/ErrorModal');
      showError(stuckMessage(progressOfCard(card()).step, { error }), error instanceof Error ? error.stack ?? '' : '');
      return;
    }
    clearGridRecovery();
    history.replaceState(history.state, '', new URL('/', location.origin));
    document.documentElement.classList.add('title-first');
    await showPageTitle();
  }
}

async function startSelected(): Promise<void> {
  const selected = bootAwait('app:selected-discovery', import('./shardSelection').then(async selection => {
    await selection.prepareSelectedShard();
    return selection;
  }));
  const [{ preparePageCatalogue, completePageCatalogue }, { game }, { beginLoading }, { TIER }] = await Promise.all([
    selected, import('@wildshard/engine/game/shard/registry'), import('@wildshard/engine/ui/Loading'),
    import('@wildshard/engine/core/tier'),
  ]);
  // C3: a catalogue shard this build has no discovery for: the page's manifest, renamed; admission replaces the rest.
  const listed = unloadedTitleRow(search.get('chunk'), game.shard);
  const arrival = listed?.shardfile === undefined ? game.shard : { ...game.shard, slug: listed.slug, name: listed.name, shardfile: listed.shardfile };
  const loading = beginLoading({ id: arrival.slug, name: arrival.name, trace: game.shard.boot?.phone?.trace === true });
  const moduleText = document.getElementById('boot-module-files')?.textContent;
  const moduleRows: unknown = moduleText === undefined ? undefined : JSON.parse(moduleText);
  const gridEntryModule = import('@wildshard/engine/game/grid/pageEntry');
  const gridMenuModule = import('@wildshard/engine/game/grid/menu');
  const [gridSelection, { gridMode, DEVSERVER }] = await Promise.all([gridEntryModule, gridMenuModule]);
  const earlyPath = gridSelection.pageGridRecovery() !== null || gridSelection.pendingGridEntry(arrival.slug)
    ? 'grid' : 'shardfile';
  // MF4: one spawn manifest per shard / tier / flow (grid: per menu mode) is the whole download; the bar reads only it and
  // admission waits for it (a tap on the title started the same job, so its files may already be in the worker cache)
  // a world entry's own import: the spawn manifest's reader stays out of the title's chunk (check-chunks)
  const { startSpawnDownload, setSpawnPacks, observeSpawnHolds } = await import('@wildshard/engine/game/boot/spawnDownload');
  setSpawnPacks(runtimePacksOn()); // DL16: Debug ▸ Loading & memory ▸ Level download
  // DL21: a read the whole-set hold stalls is named on the card as the spawn download, in its step
  observeSpawnHolds((held, path) => waitFor('Spawn download', held, 'file', `spawn-download:${path}`));
  const spawnMode = gridMode(DEVSERVER), spawnJob = startSpawnDownload(arrival.slug, earlyPath === 'grid' ? 'grid' : 'client', TIER,
    `${Number(spawnMode.developer)}${Number(spawnMode.devserver)}${Number(spawnMode.nineDragon)}`);
  if (spawnJob !== null) void loading.setDownloadSource(spawnJob);
  // Read mandatory primary declarations while services and the yielding memory
  // bank prepare. Capture any failure now; publish only at the original barrier.
  const catalogue = earlyPath === 'grid' ? prepareBootImports(preparePageCatalogue()) : null;
  if (typeof moduleRows === 'object' && moduleRows !== null) {
    if ('common' in moduleRows) readModuleFiles(moduleRows.common);
    const kind = earlyPath === 'grid' ? 'grid' : 'client';
    if (Object.hasOwn(moduleRows, kind)) readModuleFiles(Reflect.get(moduleRows, kind));
  }
  const modules = (kind: 'common' | 'client' | 'grid'): void => {
    if (moduleRows === undefined) return; // Source/dev documents have no emitted chunk inventory.
    if (typeof moduleRows !== 'object' || moduleRows === null || !Object.hasOwn(moduleRows, kind)) throw new Error('Missing boot module rows');
    preloadModuleFiles(Reflect.get(moduleRows, kind));
  };
  // This exact mandatory bank can download/compile while services prepare;
  // modulepreload never executes or publishes its modules.
  modules('common');
  // Resolve the already-required session code while services/admission yield.
  // Its failure stays captured until the original post-kit barrier below;
  // importing declarations must not start a session or publish its services.
  const sessionCode = prepareBootImports(bootAwait('app:session-code', import('@wildshard/engine/game/session/session')));
  loading.waiting('Preparing application services');
  // Resolve the same required code while each memory reserve yields. Imports
  // cannot publish content: the memory bank and full import barrier still
  // precede admission and installation, with their original refusal order.
  const [speciesModule, iconsModule, pickupsModule, pickupRowsModule, propsModule, starterModule, hoverboardModule,
    voicesModule, boarModule, familiesModule, sourceModule, runtimeModule,
    pathsModule, prefetchModule] = [
    import('@wildshard/engine/game/systems/species/install'), import('@wildshard/engine/game/icons'),
    import('@wildshard/engine/game/models/specimenCatalogue'), import('@wildshard/engine/game/data/pickupCatalogue'),
    import('@wildshard/engine/game/models/interact'), import('@wildshard/engine/game/bag/starter.generated'),
    import('@wildshard/engine/game/systems/tools/hoverboard'), import('@wildshard/engine/game/plugin/audio'),
    import('@wildshard/engine/game/systems/species/view/boar'), import('@wildshard/engine/game/plugin/weaponFamily'),
    import('@wildshard/engine/game/shardfile/clientSource'), import('@wildshard/engine/game/shardfile/runtimeProduct'),
    import('@wildshard/engine/game/boot/loadingPaths'),
    import('@wildshard/engine/game/grid/prefetch'),
  ] as const;
  const imports = prepareBootImports(bootAwait('app:common-service-imports', Promise.all([speciesModule, iconsModule, pickupsModule, pickupRowsModule, propsModule,
    starterModule, hoverboardModule, voicesModule, boarModule, familiesModule, sourceModule, runtimeModule,
    gridEntryModule, pathsModule, prefetchModule])));
  // Cover the full-ALL route's five observed misses; never recycle growables.
  const [{ prepareScriptMemoryBank }, { yieldTask }, { diagnosticNow }] = await Promise.all([
    import('@wildshard/engine/script/moduleV2'), import('@wildshard/engine/core/workSlice'),
    import('@wildshard/engine/core/clock'),
  ]);
  const memoryStartedAt = diagnosticNow();
  let memoryTurns = 0, memoryWaitMs = 0;
  await bootTask('app:script-memory-reservation', () => prepareScriptMemoryBank([35, 0, 1, 0], async () => {
    // Each native reserve gets its own task, even when the CPU budget is free.
    memoryTurns++; const at = diagnosticNow(); await yieldTask(entryScope); memoryWaitMs += diagnosticNow() - at;
    if (entryScope.disposed || entryScope.disposing) throw new Error('Entry memory preparation ended');
  }, [{ initial: 1, maximum: 2, count: 5 }, { initial: 1, maximum: 64, count: 4 }]));
  performance.measure('wildshard.prepare:boot.script-memory-bank', { start: memoryStartedAt, end: diagnosticNow(),
    detail: { memoryTurns, memoryWaitMs } });
  const [{ sharedWeaponVoices, declaredWeaponVoices }, { BOAR_LOOK }, { declaredKitItemFamilies },
    { configuredShardfile, installShardfileProduct, installManifestShardfile, preparePageResidency }, { browserShardfileOptions },
    { pageGridRecovery }, { loadingPath }, { gridPrefetchStatus }] = await Promise.all([
    voicesModule, boarModule, familiesModule, sourceModule, runtimeModule, gridEntryModule, pathsModule,
    prefetchModule,
  ]).catch(imports.refuse);
  let page: ReturnType<typeof preparePageResidency> | undefined;
  const imageOwner = entryScope.child('manifest images');
  try {
    imports.check();
    loading.setPrefetchSource(gridPrefetchStatus);
    const source = pageGridRecovery() === null ? await bootTask('app:product-source-and-read', () => configuredShardfile(document, browserShardfileOptions(document.baseURI))) : null;
    page = preparePageResidency(arrival, source?.identity.slug);
    await (await import('./assetTables')).prepareAssetPacks(page.mode === 'grid' || TIER !== 'phone' ? undefined : game.shard.slug);
    await completePageCatalogue(page.mode, catalogue?.ready);
    const path = page.mode === 'grid' ? 'grid' : 'shardfile';
    if (path === 'shardfile') modules('client');
    if (path === 'grid') modules('grid');
    // Hybrid shardfile entries retain real TypeScript stages until their page is data-only.
    loading.setPath(loadingPath(path, game.shard.boot?.steps, path === 'shardfile' && source === null && game.shard.shardfile === undefined));
    const declaredIcons = ['lock', 'check', 'poi', 'you', 'map', 'pack', 'star', 'book', 'heart', 'pin', 'laurel', 'sword', 'glyph', 'coin', 'purse', 'crossbow', 'rifle', 'lever', 'longbow', 'grapple', 'horse'] as const;
    const bindings: Parameters<typeof installShardfileProduct>[2] = {
      imageOwner,
      instance: page.instance ?? (source === null ? 'template-solo' : `standalone-${source.identity.slug}`), catalogue: [], items: declaredKitItemFamilies(), voices: declaredWeaponVoices,
      ...(page.residency === undefined ? {} : { residency: page.residency }),
      icon: (name) => { const id = declaredIcons.find((entry) => entry === name); if (id === undefined) throw new Error(`Unknown catalogue item icon ${name}`); return id; },
      recipes: new Map([['kit.look.boar', (row, species) => { if (row.animation.recipe !== 'kit.pose.quadruped') throw new Error('Unknown boar pose recipe'); return { ...BOAR_LOOK, id: row.id, species: species.id, kind: species.kind }; }]]),
    };
    imports.check();
    // DL11: setup overlaps the download (each read waits for its own file); control waits for the whole set (finish.ts)
    if (spawnJob !== null) await waitFor('Spawn download', spawnJob.listed ?? spawnJob.ready, 'file');
    const manifest = await bootAwait('app:product-admission', source === null
      ? installManifestShardfile(arrival, { ...browserShardfileOptions(document.baseURI, true), memory: page.memory, progress: (progress) => { loading.paintAdmission(progress); } }, bindings, imports.ready)
      : installShardfileProduct(source, { ...browserShardfileOptions(document.baseURI), memory: page.memory, progress: (progress) => { loading.paintAdmission(progress); } }, bindings, imports.ready));
    // Keep the seam out of code and descriptor admission; world construction
    // can overlap this read and retains its original full-geometry barrier.
    if (page.mode === 'grid') gridSelection.startGridEntryContent(page.instance ?? pageGridRecovery()?.instance ?? gridSelection.gridHome().instance);
    const previousImages = selectedImages;
    selectedImages = imageOwner;
    previousImages?.dispose();
    const [{ installKitSpecies }, { installKitIcons, BAG_ICONS }, { installPickupCatalogue, preparePickupCatalogue },
      { default: PICKUP_CATALOGUE }, { installKitProps }, { STARTER_BAG_ITEMS }, { HOVERBOARD_TOOL }, { sharedCombatCues }] = await imports.ready();
    if (source !== null || manifest.shardfile !== undefined) document.documentElement.classList.remove('title-first');
    installKitSpecies();
    installKitIcons();
    const [{boundedResponse,browserContentHash},{publicBytes}] = await Promise.all([import('@wildshard/engine/game/shardfile/product'),import('@wildshard/engine/boot/tables')]);
    const pickupAssets=publicBytes(), pickupPath=/^\/assets\/baked\/common\/pickups\/([a-f0-9]{64})\.bin$/u;
    const pickupFiles=await preparePickupCatalogue({hasFile:file=>pickupPath.test(file)&&Object.hasOwn(pickupAssets,file),file:async file=>{
      const hash=pickupPath.exec(file)?.[1],cap=pickupAssets[file];
      if(hash===undefined||cap===undefined)throw new Error('Missing pickup asset declaration');
      const bytes=await boundedResponse(await fetch(file),cap);
      if(await browserContentHash(bytes)!==hash)throw new Error('Pickup asset hash differs');
      return bytes;
    }},PICKUP_CATALOGUE,entryScope);
    installPickupCatalogue(PICKUP_CATALOGUE,pickupFiles);
    installKitProps();
    const { startSession } = await sessionCode.ready();
    bootMark('app:session-code-ready');
    bootMark('app:session-start');
    await startSession(manifest, {
      items: STARTER_BAG_ITEMS,
      tools: [HOVERBOARD_TOOL],
      combatCues: (audio, silent) => sharedCombatCues(sharedWeaponVoices(audio), silent),
      bagIcons: BAG_ICONS,
    }, { mode: page.mode, memory: page.memory, ...(crashResume === null ? {} : { crashResume }), ...(page.recovery === undefined ? {} : { recovery: page.recovery }), ...(page.residency === undefined ? {} : { residency: page.residency }) });
  } catch (error) {
    try { return await imports.refuse(error); }
    finally {
      if (selectedImages === imageOwner) selectedImages = undefined;
      imageOwner.dispose(); page?.residency?.dispose(); page?.memory.dispose();
    }
  }
}

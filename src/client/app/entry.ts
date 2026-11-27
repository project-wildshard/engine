// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '@wildshard/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-unassigned-import -- evaluated for its effect: the app identity is installed before any other module body runs (E414)
import './identity';
import { dataPointer } from '@wildshard/engine/game/shard/pointer';
import { findTitleManifest, installTitleManifests, listedArrival, readTitleRows, titleManifests, unloadedTitleRow, withCatalogueHeads } from '@wildshard/engine/game/shard/titleList';
import { installedCatalogue, installInlineCatalogue, oneCellWorld } from '@wildshard/engine/game/grid/catalogueSlot';
import { installOfflineDownload } from '@wildshard/engine/ui/offlineDownload';
import { noteWorldBoot, noteWorldStep } from '@wildshard/engine/telemetry/runtime';
import { armAnalyticsBeacon } from '@wildshard/engine/telemetry/analyticsBeacon';
import { startPageServices } from './pageServices';
import { persistHomeScreen, saves } from '@wildshard/engine/saves/runtime';
import { definePageSaveKeys } from '@wildshard/engine/game/pageSaveKeys';
import { bootWaits, waitFor } from '@wildshard/engine/boot/waits';
import { runtimePacksOn } from '@wildshard/engine/boot/loadingPacks';
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { preloadModuleFiles, readModuleFiles } from '@wildshard/engine/boot/download';
import { prepareBootImports, startTitleWarmup } from './bootDownloads';
import { MISSING_SERVER, pageServerRoute } from '@wildshard/engine/game/shardfile/serverRoute';
import { releaseInlineCandidate } from '@wildshard/engine/game/shardfile/preparedCandidate';
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
import { startLowPowerProbe, startTitleLowPowerProbe } from '@wildshard/engine/boot/lowPower';
import { guardBoot } from '@wildshard/engine/boot/stuck';
import { progressOfCard, reportCardOf, stuckContext, stuckMessage, watchStuckStep } from '@wildshard/engine/boot/stuckStep';
import { startShellClock, waitForLoadingStyles } from '@wildshard/engine/boot/shell';
import { loadPortrait } from '@wildshard/engine/boot/contentBase';
import { inspectPreviousBoot, previousBootLine, previousBootLevel } from '@wildshard/engine/boot/bootTrace';
import { Scope } from '@wildshard/engine/app/scope';
import { titleGate } from './titleGate';
import { harnessPins } from '@wildshard/engine/app/identity';
import { exploreChannel } from '@wildshard/engine/app/view/exploreChannel';
import { bootRoute, exploreBootParams, onlineTitleFirst } from './bootRoute';
import { arrivalTier, consumeTitleArrival, pendingTitleArrival, setTitleArrival } from '@wildshard/engine/boot/titleArrival';
import { lastEnd, markUnload, settleLastEnd } from '@wildshard/engine/boot/lastEnd';
import { installDropNotes, markDropStep, takeDrop, type Drop } from '@wildshard/engine/boot/dropNotice';
import { isLeavingPlay, showEnd } from '@wildshard/engine/boot/endPlay';
import { consumeCrashResume, type CrashResume } from '@wildshard/engine/game/session/crashResume';
import { bootAwait, bootMark, bootTask, bootTiming, endBootOperation } from '@wildshard/engine/boot/timing';
import { exploreSlugOfPath, retiredSlugs, slugOfPath, slugPathOf } from './slugPath';


import { installForceUpdate } from '@wildshard/engine/boot/forceUpdate';
import { installDayLogout } from '@wildshard/engine/boot/oldTab';
import { replaceFresh } from '@wildshard/engine/boot/freshPage';

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
const SHADER_SOURCE_CACHE_SLOT = 'debug.cacheShaderSources';
/** STR35: the device switch, or unset, phone Low (coordinator mini 2026-11-19, QA-FEEDBACK-2026-11-19-mini row 11). `false` keeps
 *  the old emitter on every boot for one release. */
async function shaderSourceCacheEnabled(tier: string): Promise<boolean> {
  const saved: unknown = jsonSlot(SHADER_SOURCE_CACHE_SLOT, 'device').read();
  if (typeof saved === 'boolean') return saved;
  if (tier !== 'phone') return false;
  const { graphicsMode } = await import('@wildshard/engine/core/graphicsMode');
  return graphicsMode() === 'low';
}
let crashResume: CrashResume | null = null;
let selectedImages: Scope | undefined;
const task = (): Promise<void> => new Promise((resolve) => { entryScope.timeout(0, resolve); });
const UNLISTED = 'This world is not listed. Choose a world from the list.';
/** How long the boot waits for the placement file (`placedCells.ts`'s own deadline, GO4's 3 s), its chunk's import included. */
const PLACED_DEADLINE_MS = 3000;
/** The plain home URL paints only the title. No renderer, world, or Three.js is imported until a shard is chosen. */
// RL3: the static module graph has arrived and run; index.html's 12 s self-reload stands down (only a hung module
// fetch, which never gets here, reloads by itself; anything after this is guardBoot's)
document.documentElement.dataset['booted'] = '';
startPageServices();
// The drop notice (Jake, 11-12): this page's errors and GPU loss ride the breadcrumb a title after a crash reads.
installDropNotes();
// C3: the build's catalogue, inlined in this document: no read before the first paint.
installInlineCatalogue(document);
const titleRows = withCatalogueHeads(readTitleRows(document));
installTitleManifests(titleRows);
// SA33 to SA35, the page half: a released page adds the cells the API placed after its build (its channel's signed placement file) to the
// catalogue before anything reads the grid; `enterPage` waits for it (3 s at most), and any failure keeps the build's grid.
// Fix preview PV4: a page that bakes a zone table (preview) loads every zone from the cook, beside the placement read and on its deadline;
// a late answer still installs (it only adds the zones' spawn rows and object table).
const {wait:cookedZones, settled:bakedCooks} = learnCookedZonesOnce();
const placedCells = Promise.all([learnPlacedCellsOnce(bakedCooks), cookedZones]).then(() => undefined);
// G727 / I9: Settings' "Download everything"; the prefetch loads only when the player opens or presses it
installOfflineDownload({
  size: async owner => (await import('@wildshard/engine/game/grid/prefetch')).remainingDownloadBytes(owner),
  start: async (owner, progress) => (await import('@wildshard/engine/game/grid/prefetch')).downloadEverything(owner, progress),
});
persistHomeScreen();
definePageSaveKeys(saves);
/** the page's address as the boot reads it (its harness settings, never a zone); a same-page entry (ZE10a3) reads it again */
let search = new URLSearchParams(location.search);
/** CHUNK-PARAM CP1, CP22 (J522): a tap names its zone in the tab (`titleArrival`) and leaves the address bare. Only on the game's own
 *  `/` (Explore's too): a `/slug/` page or an author's inline shard keeps its own. Not consumed here: the session consumes it, and
 *  the player's reload below drops it. No address names a zone: an old link's is ignored. */
function tappedZone(): string | null {
  if (document.getElementById('ws-shardfile') !== null || location.pathname !== '/') return null;
  return pendingTitleArrival()?.slug ?? null;
}
/** the zone this boot enters: a tap's, Explore's path's or a record's (CP22: never the address's) */
let handedZone = tappedZone();
/** CHUNK-PARAM-REMOVAL CP10 (J522): the cell of the one-cell world this page carries and boots with no tap, or null */
let inlineCell: { readonly instance: string; readonly slug: string } | null = null;
/** the zone this boot enters, else the one-cell world's */
const bootZone = (): string | null => handedZone ?? inlineCell?.slug ?? null;
const exploreSlug = exploreChannel() ? exploreSlugOfPath(location.pathname) : null;
const exploreIndex = exploreChannel() && exploreSlug === null && handedZone === null;
if (exploreChannel() && !exploreIndex) { search = exploreBootParams(search); handedZone = exploreSlug ?? handedZone; }
// Jake (11-10): Low Power Mode for Copy diagnostics, from this document's first visible second of rAF (a busy boot can
// only rule it out); the title's own idle reading starts once the title shows (boot/lowPower.ts)
startLowPowerProbe();
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
/** The page's placement file read, started at once; it never rejects and settles inside `PLACED_DEADLINE_MS` (3 s) of the entry's
 *  start, chunk import included. Past that the boot goes on with the build's grid and a late answer installs nothing. A page with no
 *  world (preview, solo) reads none. */
function learnPlacedCellsOnce(cookedReady: Promise<void>): Promise<void> {
  const late = new AbortController();
  const read = (async (): Promise<void> => {
    try {
      // a page with no world and no placement stamp (preview, solo) reads none and imports nothing (PAGE-SIZE: the title waits here)
      const stamps = globalThis as { __WS_WORLD__?: unknown; __WS_PLACEMENTS__?: unknown };
      if (stamps.__WS_WORLD__ === undefined && stamps.__WS_PLACEMENTS__ === undefined) return;
      const { learnPlacedCells, placementsOf } = await import('@wildshard/engine/game/grid/placedCells');
      const url = placementsOf(globalThis as { __WS_WORLD__?: unknown; __WS_PLACEMENTS__?: unknown });
      if (url === null || late.signal.aborted) return;
      const answer = await bootTask('app:placed-cells', () => learnPlacedCells(url, { signal: late.signal, cookedReady }));
      if ('kept' in answer) console.info(`[grid] build's grid kept: ${answer.kept}`);
      else console.info(`[grid] placement serial ${String(answer.serial)}: ${answer.added.map(cell => `${cell.instance} at (${cell.cell.join(',')})`).join(', ') || 'no new cell'}${answer.carded.length === 0 ? '' : `; carded from the catalogue ${answer.carded.join(', ')}`}${answer.left.length === 0 ? '' : `; left out ${answer.left.join('; ')}`}${answer.followed === undefined ? '' : `; rooms' revision for ${answer.followed.join(', ') || 'none'}${answer.behind?.length ? `, behind the rooms ${answer.behind.join(', ')}` : ''}`}`);
    } catch (error) { console.warn('[grid] placement file not read:', error); }
  })();
  const deadline = new Promise<void>(resolve => { entryScope.timeout(PLACED_DEADLINE_MS, () => { late.abort(); resolve(); }); });
  return Promise.race([read, deadline]);
}
/** PV4: every zone of the page's baked zone table, read from the cooked bucket; a page with none reads nothing and imports nothing. */
function learnCookedZonesOnce(): {wait: Promise<void>; settled: Promise<void>} {
  if (document.getElementById('ws-zone-table') === null) {
    const done = Promise.resolve();
    return {wait:done, settled:done};
  }
  const read = (async (): Promise<void> => {
    try {
      const { bakedZoneTable, learnCookedZones } = await import('@wildshard/engine/game/grid/cookedZones');
      const table = bakedZoneTable();
      if (table === undefined) return;
      const validator: unknown = Reflect.get(globalThis, '__WS_SHARDFILE_VALIDATOR__');
      const answer = await bootTask('app:cooked-zones', () => learnCookedZones(table, { fetch: (input, init) => fetch(input, init), signal: new AbortController().signal,
        validator: typeof validator === 'string' ? validator : null }));
      console.info(`[grid] cooked zones from ${table.from.channel} serial ${String(table.from.serial)}, cook ${table.cookVersion}: ${String(answer.installed.length)} installed${answer.missing.length === 0 ? '' : `, missing ${answer.missing.join(', ')}`}`);
    } catch (error) { console.warn('[grid] cooked zones not read:', error); }
  })();
  const deadline = new Promise<void>(resolve => { entryScope.timeout(PLACED_DEADLINE_MS, resolve); });
  return {wait:Promise.race([read, deadline]), settled:read};
}
async function enterPage(): Promise<unknown> {
  if (exploreIndex) return showExploreIndex();
  if (pageServerRoute() === 'missing') {
    const { showError } = await import('@wildshard/engine/ui/ErrorModal');
    showError(MISSING_SERVER);
    return undefined;
  }
  // S20: a crash read off another tab's live beat is no crash; asked now, answered (at most 500 ms) before the title reads it
  const settled = settleLastEnd();
  // TC-SHIP-a: progress saved under a retired slug (Brasscap Mesa's blender-template: its pack, owned items, coins and
  // achievements) reads under its replacement. The old namespace stays; entries already under the new slug win.
  for (const [retired, now] of retiredSlugs()) {
    try { saves.mergeShardEntries(retired, now); } catch (error) { console.warn(`[saves] ${retired} not carried to ${now}:`, error); }
  }
  // CP22 (J522): the zone comes from a tap or Explore's path, never an address, so no old link's retired slug is rewritten here
  const catalogue = installedCatalogue(), requested = handedZone;
  // SA36: a `/slug/<slug>` link opens that one shard's page; its PLAY leaves for `/` with the tap (CP6), so a world never boots here.
  // SA37: on every host, a world build too: PLAY's page enters the world's grid at the shard's cell (GO7 below)
  const slugged = exploreChannel() ? null : slugOfPath(location.pathname);
  // CP10 (J522): a page that carries a one-cell world (`wildshard dev`, `wildshard prepare`, a tool's zone alone) boots that world at
  // its only cell on a bare `/`, with no tap: the grid path players take (a grid intent at the cell), never the one-shard page.
  // An inline author shard runs in that cell (CP25: its descriptor, its placement and its residency, clientSource and folderCost)
  inlineCell = requested === null && slugged === null && !exploreChannel() ? oneCellWorld(catalogue) : null;
  const plainTitle = requested === null && slugged === null && inlineCell === null && document.getElementById('ws-shardfile') === null
    && bootRoute(requested, { line: previousBootLine(), level: previousBootLevel() }).titleOnly;
  // The live menu's code can arrive while styles and the previous-end query settle.
  // Placement still gates every route that can admit a world or a public shard card.
  if (plainTitle) pageTitleImports();
  // PV4: a page with a zone table paints the title's zone cards from the cook too (their art is at its object keys), so even the
  // plain title waits for the zones' objects (on the same deadline); a page without one resolves at once
  await (plainTitle ? cookedZones : placedCells);
  if (slugged !== null && requested === null) {
    const path = slugPathOf(slugged); // the address bar reads a shard's public name, not its old API slug
    if (location.pathname.replace(/\/$/u, '') !== path) history.replaceState(history.state, '', `${path}${location.search}`);
    return showSlugPage(slugged);
  }
  // An embedded author product has its own admission. A game URL must name a
  // listed world before any discovery, tables or renderer can be prepared.
  if (requested !== null && document.getElementById('ws-shardfile') === null && findTitleManifest(requested) === undefined) {
    if (exploreChannel()) return showExploreIndex(UNLISTED);
    document.documentElement.classList.add('title-first');
    showEnd({ code: 'UNLISTED', zone: requested, what: 'World not listed', why: UNLISTED }); // J501: the title's modal says it, with its code
    return showPageTitle(UNLISTED);
  }
  await waitFor('Startup stylesheets', waitForLoadingStyles(entryScope), 'file');
  await settled;
  const { consumeGridRecovery, gridRecoveryRefused, gridRecoveryPending, pageGridRecovery, pendingGridEntry, enterOneCellWorld } = await bootTask('app:page-entry-import', () => import('@wildshard/engine/game/grid/pageEntry'));
  if (inlineCell !== null) enterOneCellWorld(inlineCell.instance, inlineCell.slug);
  if (plainTitle && lastEnd().kind !== 'unexpected' && !gridRecoveryPending()) {
    document.documentElement.classList.add('title-first');
    return showPageTitle();
  }
  await placedCells;
  // QA row 16 (GO1): an online level seats a body the world sees, so only a tap enters one. Crash resume is the solo build's.
  const online = (globalThis as { __WS_WORLD__?: unknown }).__WS_WORLD__ !== undefined;
  // QA 11-12 row 35 (Jake, 20:04: "I expected reload to go back to main menu"): the player's own browser reload lands on the title,
  // before a tap still pending from this load (or the grid's one way in) can enter the world again; the title stays quiet
  // (dropNotice). A reload the engine makes marks itself first (lastEnd), so it resumes; harness flags keep their world.
  if (!exploreChannel() && lastEnd().player === true && inlineCell === null && document.getElementById('ws-shardfile') === null && !search.has('skipintro') && !search.has('tour')) {
    if (requested !== null) consumeTitleArrival(requested);
    consumeGridRecovery({ previous: lastEnd(), search });
    history.replaceState(history.state, '', new URL('/', location.origin));
    document.documentElement.classList.add('title-first');
    return showPageTitle();
  }
  // OFFLINE OF3 (J298): a world build never enters a shard its world doesn't open (the grid doesn't place it, or the world's word leaves
  // it out: the one heard on this page, else the device's kept one). The world would seat the page in another cell, so a link to it, a
  // tap or a harness URL lands on the title with "Not in this world yet". Asked before the title-first rule, so a bare link says why too.
  const world = (globalThis as { __WS_WORLD__?: unknown }).__WS_WORLD__;
  const notInWorld = async (): Promise<boolean> => online && requested !== null && document.getElementById('ws-shardfile') === null
    && !(await bootTask('app:one-way-in-import', () => import('@wildshard/engine/game/grid/oneWayIn'))).worldOpens(world)(requested);
  const notInWorldTitle = async (slug: string): Promise<void> => {
    consumeTitleArrival(slug);
    history.replaceState(history.state, '', new URL('/', location.origin));
    document.documentElement.classList.add('title-first');
    const { dropGridEntry, notInWorldLine } = await import('@wildshard/engine/game/grid/oneWayIn');
    dropGridEntry(slug);
    const line = notInWorldLine(findTitleManifest(slug)?.name ?? slug);
    // J501: a seat hop or a link the world doesn't open ends on the title's modal, with its code and Retry (Enter MMO again)
    showEnd({ code: 'NOT-IN-WORLD', zone: slug, why: line, retry: true });
    return showPageTitle(line);
  };
  if (requested !== null && await notInWorld()) return notInWorldTitle(requested);
  const tapped = inlineCell !== null || (requested !== null && (pendingTitleArrival(requested) !== null || pendingGridEntry(requested)));
  if (document.getElementById('ws-shardfile') === null && onlineTitleFirst(search, requested, online, tapped)) {
    history.replaceState(history.state, '', new URL('/', location.origin));
    document.documentElement.classList.add('title-first');
    return showPageTitle();
  }
  // GO7 (ZS5), J300: on a world build, a grid shard's page (Shard select, a seat elsewhere, a stale-build reload) enters the grid at
  // that shard's cell, so this page boots as a grid page, unless the world is known to open one cell; anything else stays a one-shard page.
  // J311: a build with no world (preview) does the same for a Shard select tap only, into its in-page grid; a harness's zone
  // (enterZone) still opens the shard alone.
  if ((online || pendingTitleArrival(requested ?? '') !== null) && requested !== null && document.getElementById('ws-shardfile') === null) {
    const { enterByShard } = await bootTask('app:one-way-in-import', () => import('@wildshard/engine/game/grid/oneWayIn'));
    await bootTask('app:one-way-in', () => enterByShard({ online, slug: requested, kept: search.has('explore') || pendingGridEntry(requested) }, world));
    // OF3 again: the one way in may have heard the world's word just now, and it may leave this shard out
    if (await notInWorld()) return notInWorldTitle(requested);
  }
  const end = lastEnd();
  const named = bootZone();
  crashResume = !online && (named === null || [end.slug].includes(named)) && !search.has('explore') ? consumeCrashResume(end, titleRows) : null;
  // SR4: after an unexpected grid end, the page's place is checked against where the server's durable continuation stands.
  // A failed or slow read keeps the page's own place, as before.
  const server = end.kind === 'unexpected' && end.mode === 'grid' ? await bootTask('app:grid-server-site', serverSites) : undefined;
  const recovery = consumeGridRecovery({ unexpected: end.kind === 'unexpected', previous: end, search, ...(server === undefined ? {} : { server }) });
  if (recovery !== null || crashResume !== null) {
    // CHUNK-PARAM CP4, CP22 (J522): the boot takes the record's zone; the address never names it. The session resumes from the
    // record (play.ts `resuming`), so no `glreload` either; a stale `at` leaves the address
    handedZone = recovery?.slug ?? crashResume?.slug ?? '';
    search.delete('at');
    const url = new URL(location.href); url.searchParams.delete('at');
    history.replaceState(history.state, '', url);
    document.documentElement.dataset['resume'] = recovery !== null ? 'grid' : 'crash';
    document.documentElement.classList.remove('title-first');
  }
  const route = exploreChannel() || recovery !== null || crashResume !== null || inlineCell !== null ? { rescue: false, titleOnly: false } : gridRecoveryRefused() ? { rescue: true, titleOnly: true } : bootRoute(bootZone(), { line: previousBootLine(), level: previousBootLevel(), reload: end.reload === true });
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
    if (exploreChannel()) document.documentElement.classList.remove('title-first');
    const chunk = bootZone(); if (chunk !== null) startShellClock(entryScope, chunk);
    // a crash that boots straight back into its world (crash resume, grid recovery) says so before its breadcrumb is replaced
    if (lastEnd().kind === 'unexpected') showDrop(takeDrop(lastEnd()));
    // the drop notice's breadcrumb: a world page, from its first step, so a crash or a silent title names where it stood
    const came = lastEnd();
    if (chunk !== null) markDropStep({ world: chunk, name: findTitleManifest(chunk)?.name ?? chunk, step: 'Start', arrivedBy: came.kind === 'fresh' ? '' : came.reason });
    const tables = prepareBootImports(bootTask('app:tables-import-and-prepare', () => import('./assetTables').then(module => module.prepareAssetTables())));
    try {
      const [tier, menu, spawn] = await bootTask('app:tier-menu-download-imports', () => Promise.all([import('@wildshard/engine/core/tier'),
        import('@wildshard/engine/game/grid/menu'), import('@wildshard/engine/game/boot/spawnDownload')]));
      await tier.initializeTier();
      const slug = bootZone();
      // SA43: a page that owns its inline shard (`wildshard dev`, `wildshard prepare`) has no catalogue download
      // for it: that shard's spawn set isn't its download (as startSelected's `authored`)
      const inlineShard = (menu.DEVSERVER || menu.PREPARATION_ONLY) && document.getElementById('ws-shardfile') !== null;
      // OF23a: the inline shard is admitted by its own index, never as a stale copy of a product this build pins
      if (inlineShard) releaseInlineCandidate(document.getElementById('ws-shardfile')?.textContent);
      if (typeof slug === 'string' && !inlineShard) {
        // CP10: a one-cell world reads its own zone's set, never a neighbour's files (the grid set lists every neighbour's discovery)
        const mode = menu.gridMode(menu.DEVSERVER), flow = inlineCell === null && (pageGridRecovery() !== null || pendingGridEntry(slug)) ? 'grid' : 'client';
        spawn.setSpawnPacks(runtimePacksOn());
        // LD2 (J208): a Start read this download holds (selected discovery behind the warm check) is named from the tap
        spawn.observeSpawnHolds((held, path) => waitFor('Spawn download', held, 'file', `spawn-download:${path}`));
        noteWorldBoot(0, tier.TIER, slug);
        noteWorldStep('download');
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
async function showExploreIndex(notice?: string): Promise<void> {
  const { showExploreIndex: show } = await import('./exploreIndex');
  show(entryScope, notice);
}

function preparePageTitleImports() {
  return prepareBootImports(Promise.all([import('@wildshard/engine/ui/StartTitle'),
    import('@wildshard/engine/game/mainMenu'), import('@wildshard/engine/game/travel/travel'),
    import('@wildshard/engine/game/zoneSelect/served')]));
}
let titleImports: ReturnType<typeof preparePageTitleImports> | undefined;
function pageTitleImports(): ReturnType<typeof preparePageTitleImports> {
  titleImports ??= preparePageTitleImports();
  return titleImports;
}
async function showPageTitle(refusal = ''): Promise<void> {
  // S20: the title's ended note reads lastEnd(), settled (the imports take longer than the lock query)
  const [[{ showStartTitle }, { buildTitleMenu, installGridTitle }, { travel }, { zoneSelectSource }]] = await Promise.all([pageTitleImports().ready(), settleLastEnd()]);
  if (document.querySelector('.ws-load[data-failed="true"]') !== null) return;
  const mountedCatalogue = installedCatalogue(), mountedTitles = titleManifests();
  // SF21a: a tap or validated recovery selects a grid; unrecorded process loss returns to title
  const grid = installGridTitle();
  // FM4 9b/10b: on a world build, Enter world asks the world first and may hold on a card until it is back (no title weight: the
  // gate's code loads on the tap)
  const world = (globalThis as { __WS_WORLD__?: unknown }).__WS_WORLD__;
  const gate = world === undefined ? undefined : titleGate(world, () => import('@wildshard/engine/game/grid/oneWayIn'));
  const selectSource = zoneSelectSource(document, world);
  let servedZones = selectSource.initial();
  let menu: ReturnType<typeof buildTitleMenu> | undefined;
  // the composition root wires the game's main menu (over its shard deck) into the engine's title (E405)
  const title = showStartTitle(({ settings, notice }) => {
    const lines = [refusal, notice ?? '', grid.note].filter((line) => line !== '').join('\n');
    const screen = menu?.screen ?? grid.screen;
    menu = buildTitleMenu({
      active: null,
      zoneSelect: servedZones,
      onPress: selectSource.press,
      onEnter: (card) => { travel({ to: card.slug, mode: 'enter' }); },
      onGrid: grid.onGrid,
      ...(gate === undefined ? {} : { gate }),
      ...(screen === undefined ? {} : { screen }),
      // Settings needs common inventory and level predicates, without booting a renderer.
      onSettings: () => { void (async () => { const { openTitleSettings } = await import('./titleSettings'); await openTitleSettings(settings); })(); },
      ...(lines === '' ? {} : { notice: lines }),
    });
    return menu;
  });
  // Published cards can arrive after the first menu. Rebuild through the same
  // owner as Developer changes once a name prompt or entry is clear.
  void (async (): Promise<void> => {
    await placedCells;
    if (installedCatalogue() === mountedCatalogue && titleManifests() === mountedTitles) return;
    await menu?.whenIdle();
    title.refresh();
  })();
  async function refreshServedZones(): Promise<void> {
    const live = await selectSource.refresh();
    if (live === null) return;
    servedZones = live;
    await menu?.whenIdle();
    title.refresh();
  }
  entryScope.raf(() => {
    entryScope.raf(() => { void refreshServedZones(); });
  });
  // DL10 (Debug 'Early shader compile', default off): after the title's first frames, one trivial shader link starts the
  // GPU process's compiler, so a cold entry's first program does not pay its 1-1.4 s start-up
  // J501: the drop modal's Retry enters again the way the title does: Enter MMO on a world build (its gate first), else the zone
  showDropOnTitle((drop) => {
    if (world !== undefined) {
      if (gate === undefined) grid.onGrid();
      else void gate(grid.onGrid);
      return;
    }
    if (drop.world !== '') travel({ to: drop.world, mode: 'enter' });
  });
  startTitleLowPowerProbe(); // Jake (11-10): the shown title, once idle, reads Low Power Mode for the tab (boot/lowPower.ts)
  void startTitleWarmup(import('@wildshard/engine/boot/earlyPrograms'), entryScope, window);
}

/**
 * SA36 (Jake, grill Q14 to Q16): the `/slug/<slug>` page, one shard's card and hero (src/client/game/slugPage.ts). PLAY travels to
 * `/` with the tap as a Shard select tap does (CHUNK-PARAM CP6), so that page enters the grid at the shard's cell (grid/oneWayIn.ts); a shard the
 * grid doesn't place keeps PLAY disabled. A slug no title row names goes to the title with the unlisted line.
 */
async function showSlugPage(slug: string): Promise<void> {
  document.documentElement.classList.add('title-first');
  await settleLastEnd(); // S20: its ended note reads lastEnd()
  const manifest = findTitleManifest(slug);
  // the page's query (`?sw=0`, `?tier=`, …) rides along to `/`, as a Shard select tap keeps it
  const home = (): URL => new URL(`/${location.search}`, location.origin);
  if (manifest === undefined) {
    history.replaceState(history.state, '', home());
    return showPageTitle(UNLISTED);
  }
  const [{ showStartTitle }, { buildSlugPage }, { installGridTitle }, { shardCell }, { travel }] = await Promise.all([
    import('@wildshard/engine/ui/StartTitle'), import('@wildshard/engine/game/slugPage'), import('@wildshard/engine/game/mainMenu'),
    import('@wildshard/engine/game/grid/oneWayIn'), import('@wildshard/engine/game/travel/travel')]);
  const grid = installGridTitle();
  const placed = shardCell(manifest.slug) !== undefined;
  const enter = (card: { readonly slug: string }): void => {
    // the shard's page is `/` with its tap: travel keeps this document's path, so the link's path goes first
    history.replaceState(history.state, '', home());
    travel({ to: card.slug, mode: 'enter' });
  };
  showStartTitle(({ notice }) => {
    const lines = [notice ?? '', grid.note].filter((line) => line !== '').join('\n');
    return buildSlugPage({ manifest, placed, onEnter: enter,
      ...(lines === '' ? {} : { notice: lines }) });
  });
  showDropOnTitle();
  startTitleLowPowerProbe();
  void startTitleWarmup(import('@wildshard/engine/boot/earlyPrograms'), entryScope, window);
}

/**
 * The drop modal (Jake, 2026-11-12): a title the player did not ask for says why, once. Plain words for everyone, the real error
 * with Developer on; every drop also goes to Sentry where the page reports there (src/client/engine/boot/dropNotice.ts).
 */
function showDropOnTitle(retry?: (drop: Drop) => void): void { showDrop(takeDrop(lastEnd()), retry); }
function showDrop(drop: ReturnType<typeof takeDrop>, retry?: (drop: Drop) => void): void {
  if (drop === null) return;
  void (async () => {
    try {
      const [{ showDropModal }, { isDev }] = await Promise.all([import('./dropModal'), import('@wildshard/engine/core/devMode')]);
      const abrupt = previousBootLine();
      // Jake (17:52): every title nobody asked for is an error, so the modal's open reports it (SENTRY-TRIAGE S13, `screen:title-drop`)
      showDropModal(drop, entryScope, { dev: isDev(), ...(abrupt === '' ? {} : { extra: [abrupt] }), ...(retry === undefined ? {} : { retry }) });
    } catch (error) {
      // J501: the drop modal's own code failed to load (a stale chunk, the network): the fatal modal says it instead, never silence
      console.error('[drop] the drop modal did not open', error);
      try { (await import('@wildshard/engine/ui/ErrorModal')).showError(`${drop.what}: ${drop.reason}${drop.code === '' ? '' : ` (code ${drop.code})`}`); }
      catch { /* both modals' code is gone: the console line above is all this page can do */ }
    }
  })();
}

// QA 11-19 row 19: the Web Analytics beacon loads a second after the title or a world is first interactive, never on the
// `load` path. Armed here, as the page entry evaluates: a launch that stays on the title never runs start().
armAnalyticsBeacon(entryScope);
// fix-preview PV12 (Jake, 2026-11-26: "a logout after 24 hours of a game client being open is simplest")
installDayLogout(entryScope);
const clientVersion: unknown = Reflect.get(globalThis, '__WS_CLIENT_VERSION__');
export const entered: Promise<unknown> = installForceUpdate(typeof clientVersion === 'string' ? clientVersion : '', entryScope).then(accepted => accepted ? enterPage() : undefined);
guardBoot(entered);

/** Composition root: select authored content and inject reusable kit recipes. */
/** ZE10d: the page's latest start, its post-control work included: a same-page entry unloads only once it has settled, so two
 *  entries never overlap (a start's failure path would otherwise send the page to the title in the middle of the next) */
let latestStart: Promise<void> = Promise.resolve();
export function start(): Promise<void> {
  // ZE10d: the same-page entry is in place from control on. A gate can reach 0 before this start's post-control work returns, and
  // without it the gate took the fresh-page form's read-ahead and read the target under the old world (desktop, 52 to 124 reads)
  entryScope.listen(document, 'ws:control-ready', () => {
    void (async () => {
      try { await installInPageEntry(); } catch (error) { console.warn('[grid] the same-page entry was not installed at control', error); }
    })();
  }, { once: true });
  const run = startPage();
  latestStart = run.catch(() => undefined);
  return run;
}
async function startPage(): Promise<void> {
  // DL21: a start whose card stops moving (step, setup share, bytes) names its step after a bounded wait instead of
  // leaving a dead card; the fatal modal's RELOAD HERE is the retry (src/client/engine/boot/stuckStep.ts)
  // never the SB5 veil copy (a still image of the last card, Loading.ts `veilCard`): its frozen dataset is no boot's progress
  const card = (): HTMLElement | null => document.querySelector<HTMLElement>('.ws-load:not([data-veil])');
  // S4: the report says why: the card's step, rows, files, bytes, the link and visibility
  // best effort: a failed read never stops the report or the modal (Codex, J206)
  const stall = (): Record<string, unknown> => {
    try {
      // TR-4b: the boot's own operations still open, newest last: a stall names the await it sits in (hosted T1 runs
      // stopped in "home" and "road" with no reads and no named wait), in the report and in the console a trace keeps
      const now = Number(document.timeline.currentTime ?? 0), open = (bootTiming()?.entries ?? []).filter(row => row.end === null).slice(-12)
        .map(row => `${row.operation} ${((now - row.start) / 1000).toFixed(1)}s`);
      // and every named wait still pending (a step's inner await: the road's tile writes and capture worker)
      const waits = bootWaits().map(wait => `${wait.label} ${(wait.ageMs / 1000).toFixed(1)}s`);
      const why = { ...stuckContext(reportCardOf(card()), {
        connection: (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType, visibility: document.visibilityState }), open, waits };
      console.warn('[boot] stalled', JSON.stringify(why));
      return why;
    } catch { return { unreadable: true }; }
  };
  const started = startSelected();
  let slowShown = 0, removeSlow = (): void => undefined;
  watchStuckStep(started, {
    progress: () => progressOfCard(card(), document),
    hidden: () => document.visibilityState === 'hidden',
    every: (ms, run) => { const timer = entryScope.interval(ms, run); return () => { entryScope.cancelTimer(timer); }; },
    stalled: (step, stuckMs) => { const why = stall(); void (async () => { (await import('@wildshard/engine/ui/ErrorModal')).showError(stuckMessage(step, { stuckMs }), '', why); })(); },
    // QA 11-19 row 17: a step past its own deadline gets the slow strip (Retry, Exit to title, a connection check) and a
    // non-fatal report, so a stuck entry is never silent before the fatal card (src/client/engine/ui/slowLoad.ts)
    slow: (step, stuckMs) => { const shown = ++slowShown, why = stall(); void (async () => {
      const [modal, { emitFault }, { showSlowLoad }] = await Promise.all([import('@wildshard/engine/ui/ErrorModal'), import('@wildshard/engine/core/faults'), import('@wildshard/engine/ui/slowLoad')]);
      modal.installErrorModal();
      emitFault({ system: 'boot.slow', error: Object.assign(new Error(`Loading slow at step "${step}" (no progress for ${String(Math.round(stuckMs / 1000))} s)`), { detail: why }), verdict: 'retry' });
      if (shown === slowShown) { removeSlow(); removeSlow = showSlowLoad(entryScope, step, stuckMs, card()); }
    })(); },
    recovered: () => { slowShown++; removeSlow(); removeSlow = (): void => undefined; },
  });
  try { await started; await installInPageEntry(); }
  catch (error) {
    // J501: a boot step that already left through endPlay / reloadPlay (row 20's newer revision) shows nothing more
    if (isLeavingPlay(error)) return;
    const { pageGridRecovery, clearGridRecovery } = await import('@wildshard/engine/game/grid/pageEntry');
    if (pageGridRecovery() === null) {
      // Admission can refuse before startSession installs its fatal-load boundary. main starts asynchronously;
      // paint the same fatal card here, naming the step it died on, instead of leaving a rejected boot behind the loader.
      const { showError } = await import('@wildshard/engine/ui/ErrorModal');
      showError(stuckMessage(progressOfCard(card()).step, { error }), error instanceof Error ? error.stack ?? '' : '', stall());
      return;
    }
    clearGridRecovery();
    showEnd({ code: 'RESTORE-FAIL', why: 'The world could not be restored after the last session ended, so the game went back to the title.', error, retry: true });
    history.replaceState(history.state, '', new URL('/', location.origin));
    document.documentElement.classList.add('title-first');
    await showPageTitle();
  }
}

/**
 * ZONE-ENTRY ZE10a2 and ZE10a3: the page enters a grid home again without a reload. The level is unloaded, the session's Game
 * retired (its canvas context kept for the next one), and the page's start runs again, reading the grid intent and the title
 * arrival the caller wrote. A zone entry's travel uses it (`setInPageEntry`); a harness page can call it as
 * `window.__wildshardReenter(instance, slug)`.
 */
async function installInPageEntry(): Promise<void> {
  const [{ app }, { setInPageEntry }] = await Promise.all([import('@wildshard/engine/app/runtime'), import('@wildshard/engine/game/travel/travel')]);
  const again = async (slug: string, art: string | undefined, url: URL | undefined, screen?: () => void): Promise<void> => {
    await latestStart;
    try {
      await app.unloadLevel();
      // ZE10d: the entry's loading screen goes at the target's control (the old level is gone, so the next control is the target's),
      // not when the next start returns: its post-control work kept the screen up at Pine's control and refused the next gate's 0
      if (screen !== undefined) entryScope.listen(document, 'ws:control-ready', screen, { once: true });
      // the old world's idle caches (its kit, its textures) go as a fresh page would drop them, through the renderer that
      // uploaded them (a disposed renderer deletes nothing on the GPU): the next home is charged alone
      app.assets.evictIdleCaches();
      (await import('@wildshard/engine/core/assets')).forgetUploadedSources();
      (await import('@wildshard/engine/game/plugin/heldEquipment')).forgetHeldCatalogues();
      // the session's Game goes; its canvas context stays for the next one (a fresh canvas after a forced loss stalled the next boot)
      app.render?.dispose(true);
      if (url !== undefined) history.replaceState(history.state, '', url);
      search = new URLSearchParams(location.search);
      handedZone = tappedZone(); // CP1: the zone this entry's travel wrote in the tap
      crashResume = null; // the first boot's crash resume, never the next zone's
      const [{ setActiveChunk }, { retireEntryReloadCapture }, { resetFolderControl }] = await Promise.all([import('@wildshard/engine/game/shard/registry'),
        import('@wildshard/engine/game/grid/pageEntry'), import('@wildshard/engine/game/shardfile/runtimeFolder')]);
      retireEntryReloadCapture();
      resetFolderControl();
      // the running manifest is resolved once a page; the next session's is the target, as a fresh page at this address would read
      setActiveChunk(slug);
      // ZE10c: the target's art is read only once the old world is gone
      if (art !== undefined && art !== '') loadPortrait(art);
    } catch (error) {
      // a teardown that fails leaves this page unfit for a second session: the fresh page takes the same handoff and arrival
      console.warn('[grid] same-page entry could not retire the last world; entering on a fresh page', error);
      markUnload('zone entry (fresh page after a failed same-page retire)');
      replaceFresh(url ?? location.href);
      return;
    }
    await start();
  };
  // ZE10d2: a world build (staging, play) enters in the page too once its gate has handed the online link to the next session
  // (`pageEntry.ts` `enterZone` asks only then); preview and solo always do
  setInPageEntry((request, url) => again(request.to, request.shown?.art, url, request.inPage));
  if (harnessPins() === undefined) return;
  Reflect.set(window, '__wildshardReenter', async (instance: string, slug: string): Promise<void> => {
    const { intendGridHome } = await import('@wildshard/engine/game/grid/pageEntry');
    intendGridHome(instance, slug);
    setTitleArrival({ slug, mode: 'enter', tier: arrivalTier.current });
    await again(slug, undefined, undefined);
  });
  // the zone entry itself, as a gate's 0 calls it, and the pending arrival a boot would read
  Reflect.set(window, '__wildshardEnterZone', async (instance: string): Promise<void> => { (await import('@wildshard/engine/game/grid/pageEntry')).enterZone(instance); });
  Reflect.set(window, '__wildshardArrival', (slug: string) => pendingTitleArrival(slug));
  const { zoneEntryPending } = await import('@wildshard/engine/game/grid/pageEntry');
  Reflect.set(window, '__wildshardZonePending', zoneEntryPending);
}

/** NB19: the inline candidate's discovery document, read where the page serves it. */
async function readJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Inline runtime discovery answered ${response.status}`);
  return JSON.parse(await response.text());
}

async function askPhoneMemory(root: HTMLElement, scope: Scope): Promise<void> {
  const { confirmPhoneMemory } = await import('./phoneMemoryWarning');
  await confirmPhoneMemory(root, scope);
}

/** The opt-in cache stays outside the mandatory startup module bank. */
async function prepareShaderSourceCache(zone: string): Promise<void> {
  const { openShaderSourceCache, shaderBookIdentity } = await import('./shaderSourceStore');
  await openShaderSourceCache(shaderBookIdentity(Reflect.get(globalThis, '__WS_RENDERER_REVISION__'), __BUILD_ID__), zone, entryScope);
}

async function startSelected(): Promise<void> {
  const selected = bootAwait('app:selected-discovery', import('./shardSelection').then(async selection => {
    await selection.prepareSelectedShard(bootZone());
    return selection;
  }));
  const [{ preparePageCatalogue, completePageCatalogue }, { game }, { beginLoading }, { TIER }] = await Promise.all([
    selected, import('@wildshard/engine/game/shard/registry'), import('@wildshard/engine/ui/Loading'),
    import('@wildshard/engine/core/tier'),
  ]);
  // C3: a catalogue shard this build has no discovery for: the page's manifest, renamed; admission replaces the rest.
  const listed = unloadedTitleRow(bootZone(), game.shard);
  const arrival = listed?.shardfile === undefined ? game.shard : listedArrival(game.shard, { slug: listed.slug, name: listed.name, shardfile: listed.shardfile });
  const loading = beginLoading({ id: arrival.slug, name: arrival.name, trace: game.shard.boot?.phone?.trace === true });
  if (await shaderSourceCacheEnabled(TIER)) await prepareShaderSourceCache(arrival.slug);
  // BUGBASH-LOOP (J385, Jake 2026-11-16): a loading world shows exactly one screen, its own full-screen card. No live menu
  // over it (PZ27b2 put the main menu, then Shard Select, over the world's mounting HUD and shrank this card to a 3 px bar),
  // and never the launch shell (a page that booted a world from the title's address still carries it).
  document.documentElement.classList.remove('boot-menu');
  document.querySelector('[data-title-shell]')?.remove();
  const moduleText = document.getElementById('boot-module-files')?.textContent;
  const moduleRows: unknown = moduleText === undefined ? undefined : JSON.parse(moduleText);
  const gridEntryModule = import('@wildshard/engine/game/grid/pageEntry');
  const gridMenuModule = import('@wildshard/engine/game/grid/menu');
  const [gridSelection, { gridMode, DEVSERVER, PREPARATION_ONLY }] = await Promise.all([gridEntryModule, gridMenuModule]);
  const earlyPath = gridSelection.pageGridRecovery() !== null || gridSelection.pendingGridEntry(arrival.slug)
    ? 'grid' : 'shardfile';
  // MF4: one spawn manifest per shard / tier / flow (grid: per menu mode) is the whole download; the bar reads only it and
  // admission waits for it (a tap on the title started the same job, so its files may already be in the worker cache)
  // a world entry's own import: the spawn manifest's reader stays out of the title's chunk (check-chunks)
  const { startSpawnDownload, setSpawnPacks, observeSpawnHolds, adoptSpawnReruns } = await import('@wildshard/engine/game/boot/spawnDownload');
  setSpawnPacks(runtimePacksOn()); // DL16: Debug ▸ Loading & memory ▸ Level download
  // DL21: a read the whole-set hold stalls is named on the card as the spawn download, in its step
  observeSpawnHolds((held, path) => waitFor('Spawn download', held, 'file', `spawn-download:${path}`));
  // SA15: `wildshard dev`'s page carries the author's shard inline; the catalogue shard's spawn set isn't its download.
  // SA43: so does `wildshard prepare`'s, a preparation-only production build; only those two builds own an inline shard
  const inlineOwner = DEVSERVER || PREPARATION_ONLY, authored = inlineOwner && document.getElementById('ws-shardfile') !== null;
  if (authored) releaseInlineCandidate(document.getElementById('ws-shardfile')?.textContent);
  const spawnMode = gridMode(DEVSERVER), spawnJob = authored ? null : startSpawnDownload(arrival.slug, earlyPath === 'grid' && inlineCell === null ? 'grid' : 'client', TIER,
    `${Number(spawnMode.developer)}${Number(spawnMode.devserver)}${Number(spawnMode.nineDragon)}`);
  if (spawnJob !== null) void loading.setDownloadSource(spawnJob);
  // FM6: a refused download that runs again (finish.ts) paints on the same card
  if (spawnJob !== null) { adoptSpawnReruns(next => { void loading.setDownloadSource(next); }); entryScope.onDispose(() => { adoptSpawnReruns(null); }); }
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
    import('@wildshard/engine/game/shardfile/clientSource'), import('@wildshard/engine/game/shardfile/runtimeFolder'),
    import('@wildshard/engine/game/boot/loadingPaths'),
    import('@wildshard/engine/game/grid/prefetch'),
  ] as const;
  const imports = prepareBootImports(bootAwait('app:common-service-imports', Promise.all([speciesModule, iconsModule, pickupsModule, pickupRowsModule, propsModule,
    starterModule, hoverboardModule, voicesModule, boarModule, familiesModule, sourceModule, runtimeModule,
    gridEntryModule, pathsModule, prefetchModule])));
  const [{ sharedWeaponVoices, declaredWeaponVoices }, { boarLook }, { declaredKitItemFamilies, declaredItemIcon },
    { configuredShardfile, installShardfileFolder, installManifestShardfile, preparePageResidency, inlineRuntimeArrival, selectInlineRuntime }, { browserShardfileOptions },
    { pageGridRecovery }, { loadingPath }, { gridPrefetchStatus }] = await Promise.all([
    voicesModule, boarModule, familiesModule, sourceModule, runtimeModule, gridEntryModule, pathsModule,
    prefetchModule,
  ]).catch(imports.refuse);
  let page: ReturnType<typeof preparePageResidency> | undefined;
  const imageOwner = entryScope.child('manifest images');
  try {
    imports.check();
    loading.setPrefetchSource(gridPrefetchStatus);
    const inline = pageGridRecovery() === null ? await bootTask('app:product-source-and-read', () => configuredShardfile(document, browserShardfileOptions(document.baseURI, inlineOwner))) : null;
    // NB19: an inline candidate that declares a runtime enters as the catalogue enters it, by its own discovery's
    // client-plan entry on the page that owns this inline candidate. A bare inline arrival has no runtime composition.
    const runtimePage = inline === null || !inlineOwner ? null : await inlineRuntimeArrival(inline, { base: document.baseURI }, readJson);
    const source = runtimePage === null ? inline : null, admitted = runtimePage ?? arrival;
    const selectedPage = preparePageResidency(admitted, source?.identity.slug);
    page = selectedPage;
    const waitForMemoryWarning = (slug?: string): Promise<void> | undefined =>
      selectedPage.memory.waitForWarning(() => askPhoneMemory(loading.root, loading.scope), slug);
    await waitForMemoryWarning(admitted.slug);
    // The script memory bank (scriptMemoryPlan.ts): each reserve can cost JSC a full GC (e472f34069). NINE-DRAGON-BENCHMAX NB4:
    // Nine's standalone page took 1 of a 45 bank by control, while the 45 cost Jake's Low Power iPhone 1.1 s of modules.
    // SB47: a grid page reserves the standalone bank under the loader too (its one home cell), and tops up the full-ALL
    // route's demand for its cell activations after control, a reserve an idle turn. A miss allocates in place, as before.
    const grid = page.mode === 'grid';
    const assetTables = await import('./assetTables'), packs = assetTables.prepareAssetPackRead(grid || TIER !== 'phone' ? undefined : game.shard.slug);
    const [{ prepareScriptMemoryBank }, { yieldTask }, { diagnosticNow }, { reserveScriptMemory, scriptMemoryTopUp, SCRIPT_MEMORY_TOP_UP_SLOT }, { idleTurn }] = await Promise.all([
      import('@wildshard/engine/script/moduleV2'), import('@wildshard/engine/core/workSlice'),
      import('@wildshard/engine/core/clock'), import('./scriptMemoryPlan'), import('@wildshard/engine/boot/idle'),
    ]);
    const savedTopUp = (): unknown => { try { return jsonSlot(SCRIPT_MEMORY_TOP_UP_SLOT, 'device').read(); } catch { return null; } };
    // DW3: unset, phone Low skips the top-up (scriptMemoryPlan.ts)
    const phoneLow = TIER === 'phone' && (await import('@wildshard/engine/core/graphicsMode')).graphicsMode() === 'low';
    const memoryStartedAt = diagnosticNow();
    // NB4: a reserve yields once its slice has run 8 ms, not after every reserve. In Chromium the 45 reserves cost
    // 0.6 ms together; the 45 timer turns between them were the whole 0.35 s of this span at CPU x4 (NB1). A reserve
    // that does cost JSC a full GC still spends its slice, so it still ends its own task.
    let memoryTurns = 0, memoryWaitMs = 0, memorySliceAt = diagnosticNow();
    await bootTask('app:script-memory-reservation', () => reserveScriptMemory(grid, { prepare: prepareScriptMemoryBank,
      yieldTask: async () => {
        if (diagnosticNow() - memorySliceAt >= 8) {
          memoryTurns++; const at = diagnosticNow(); await yieldTask(entryScope); memorySliceAt = diagnosticNow(); memoryWaitMs += memorySliceAt - at;
        }
        if (entryScope.disposed || entryScope.disposing) throw new Error('Entry memory preparation ended');
      },
      afterControl: (run) => { entryScope.listen(document, 'ws:control-ready', run, { once: true }); },
      idle: () => idleTurn(entryScope), topUp: scriptMemoryTopUp(savedTopUp(), phoneLow) }));
    performance.measure('wildshard.prepare:boot.script-memory-bank', { start: memoryStartedAt, end: diagnosticNow(),
      detail: { memoryTurns, memoryWaitMs, grid } });
    await packs.ready();
    // SA43: the inline candidate's own cook mounts join the byte table (assetTables.ts adoptInlineMounts)
    if (authored) await assetTables.adoptInlineMounts(JSON.parse(document.getElementById('ws-shardfile')?.textContent ?? 'null'), document.baseURI);
    await completePageCatalogue(page.mode, catalogue?.ready);
    if (runtimePage !== null) selectInlineRuntime(runtimePage);
    const path = page.mode === 'grid' ? 'grid' : 'shardfile';
    if (path === 'shardfile') modules('client');
    if (path === 'grid') modules('grid');
    // Runtime shardfile entries retain real TypeScript stages until their page is data-only.
    loading.setPath(loadingPath(path, game.shard.boot?.steps, path === 'shardfile' && source === null && dataPointer(game.shard) === undefined));
    const bindings: Parameters<typeof installShardfileFolder>[2] = {
      imageOwner,
      instance: page.instance ?? (source === null ? 'template-solo' : `standalone-${source.identity.slug}`), catalogue: [], items: declaredKitItemFamilies(), voices: declaredWeaponVoices,
      ...(page.residency === undefined ? {} : { residency: page.residency }),
      icon: declaredItemIcon,
      recipes: new Map([['kit.look.boar', (row, species) => { if (row.animation.recipe !== 'kit.pose.quadruped') throw new Error('Unknown boar pose recipe'); return boarLook({ id: row.id, species: species.id, kind: species.kind }); }]]),
    };
    imports.check();
    // DL11: setup overlaps the download (each read waits for its own file); control waits for the whole set (finish.ts)
    if (spawnJob !== null) await waitFor('Spawn download', spawnJob.listed ?? spawnJob.ready, 'file');
    const folderOptions: Parameters<typeof installShardfileFolder>[1] = {
      ...browserShardfileOptions(document.baseURI, source === null || inlineOwner), memory: page.memory,
      progress: progress => { loading.paintAdmission(progress); },
    };
    const manifest = await bootAwait('app:product-admission', source === null
      ? installManifestShardfile(admitted, folderOptions, bindings, imports.ready)
      : installShardfileFolder(source, folderOptions, bindings, imports.ready));
    await waitForMemoryWarning();
    // Keep the seam out of code and descriptor admission; world construction
    // can overlap this read and retains its original full-geometry barrier.
    if (page.mode === 'grid') gridSelection.startGridEntryContent(page.instance ?? pageGridRecovery()?.instance ?? gridSelection.gridHome().instance);
    const previousImages = selectedImages;
    selectedImages = imageOwner;
    previousImages?.dispose();
    const [{ installKitCreatureSounds }, { installKitIcons, BAG_ICONS }, { installPickupCatalogue, preparePickupCatalogue },
      { default: PICKUP_CATALOGUE }, { installKitProps }, { STARTER_BAG_ITEMS }, { HOVERBOARD_TOOL }, { sharedCombatCues }] = await imports.ready();
    if (source !== null || dataPointer(manifest) !== undefined) document.documentElement.classList.remove('title-first');
    installKitCreatureSounds();
    installKitIcons();
    const [{browserContentHash},{publicBytes},{readContent}] = await Promise.all([import('@wildshard/engine/game/shardfile/folder'),import('@wildshard/engine/boot/tables'),import('@wildshard/engine/boot/contentRead')]);
    const pickupAssets=publicBytes(), pickupPath=/^\/assets\/baked\/common\/pickups\/([a-f0-9]{64})\.bin$/u;
    // FM6 mode 44: a pickup file is a pack read like any other: a short or wrong-hash file retries, then waits on the card's RETRY
    // (`packs-5xx pack-broken`), never the generic startup refusal; its bytes stay exact-length and hash-verified
    const pickupFiles=await preparePickupCatalogue({hasFile:file=>pickupPath.test(file)&&Object.hasOwn(pickupAssets,file),file:async file=>{
      const hash=pickupPath.exec(file)?.[1],cap=pickupAssets[file];
      if(hash===undefined||cap===undefined)throw new Error('Missing pickup asset declaration');
      const bytes=await readContent(file,cap,{fetch:(address,init)=>fetch(address,init),expectedBytes:cap,verify:async read=>await browserContentHash(read)===hash});
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

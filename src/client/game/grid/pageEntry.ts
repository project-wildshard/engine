import { beginNavigationShell } from '@wildshard/engine/boot/shell';
import { pageScope } from '@wildshard/engine/app/resources';
import { registerBeforeReload, type LastEnd } from '@wildshard/engine/boot/lastEnd';
import { freshPageArrival, pendingTitleArrival } from '@wildshard/engine/boot/titleArrival';
import type { Scope } from '@wildshard/engine/app/scope';
import { saves } from '@wildshard/engine/saves/runtime';
import type { SaveStore } from '@wildshard/engine/saves/store';
import { GridAssembly, type GridCell } from '../../../shared/game/grid/assembly';
import { pageGridIntents } from './intent';
import { DEVSERVER, gridMode, type MenuMode } from './menu';
import { gridRecovery, recoveryCatalogue, type GridRecoveryRecord } from '../../../shared/game/grid/recovery';
import { setPageMode } from '../../../shared/game/grid/pageMode';
import { pageGridCells as gridCells } from '../../../shared/game/grid/cellEvents';
import type { PageMode } from '../plugin/context';
import { findTitleManifest } from '../shard/titleList';
import { travel, travelSlot } from '../travel/travel';
import { startEntryDownload } from '../shardfile/entryTransport';
import { startGridStripDownload } from './entryDownloads';
import { titlePrefetchChoice } from './titlePrefetchChoice';

// P0 (Jake's phone, tap -> loader): the page entry routes on these before anything else, so this module stays off
// three.js and the game graph (src/client/app/entry.ts imports it first; plugin/ui's 3.2 MB closure evaluated in that task).
/**
 * Infinite Wildshard's way in (SF21a). The catalogue's home cell boots through the normal shard flow as page mode
 * `'grid'`; its live grid session borrows that world and transfers the traveller between admitted frames. A title tap
 * or a validated recovery record selects the home before normal memory admission and descriptor hydration.
 *
 *   title tap  → enterGrid()               the one-shot intent, then a fresh document for the home cell
 *   boot       → bootPageMode(slug)         consumes the tap or uses validated recovery; the URL drops to the bare title
 *                                           URL, so an unrecorded reload (or an iOS kill's restart) lands on the title
 *   alive beat → pageMode()                 AliveInfo.mode, so the title can say the grid ended unexpectedly
 */


/** the home cell of the grid this device would assemble now (Developer and DEVSERVER apply at grid start) */
export function gridHome(mode?: MenuMode): GridCell {
  const assembly = new GridAssembly(gridMode(DEVSERVER, mode));
  const home = assembly.at(0, 0);
  if (home === undefined) throw new Error('The grid catalogue has no home cell at (0, 0)');
  return home;
}

let navigating: Scope | null = null;
/** The composition root resumes this exact home's geometry after code and
 * descriptor admission. Metadata already crossed the title handoff; grid readers
 * retain their complete verified geometry/construction readiness barrier. */
export function startGridEntryContent(home: string): void {
  startGridStripDownload(gridMode(DEVSERVER), home, 'mesh');
}

/** Paint the loading shell before the title's durable handoff and fresh-page navigation. */
export function enterGrid(): void {
  if (navigating !== null && !navigating.disposed) return;
  const home = gridHome();
  const target = findTitleManifest(home.slug);
  if (target === undefined) throw new Error(`The grid's home cell names no shard: ${home.slug}`);
  startEntryDownload(target.slug, 'grid');
  titlePrefetchChoice(saves).remember(target.slug, 'grid');
  startGridStripDownload(gridMode(DEVSERVER), home.instance, 'metadata');
  navigating = beginNavigationShell(target.name, pageScope, () => {
    // A deliberate new player attempt starts a new guard window; automatic reloads cannot clear it.
    if (!gridRecovery(saves).clearLoop()) throw new Error('Grid recovery guard could not be cleared');
    clearGridRecovery();
    pageGridIntents().set({ instance: home.instance, slug: target.slug });
    travel({ to: target.slug, mode: 'enter' });
  }, document.querySelector<HTMLButtonElement>('.ws-main-grid'));
}



/** The boot's one read of the tap intent (used or not), overridden by validated recovery before ordinary admission.
 * In grid mode the address becomes the bare title URL, preventing an unrecorded automatic restart. */
export function bootPageMode(slug: string): PageMode {
  let intent = null;
  try { intent = pageGridIntents().consume(slug); } catch { /* blocked storage: no intent, the normal shard flow */ }
  const recovery = pageGridRecovery();
  if (recovery !== null && [slug].includes(recovery.slug)) intent = { instance: recovery.instance, slug: recovery.slug, at: recovery.at };
  const mode: PageMode = intent === null ? 'shard' : 'grid';
  setPageMode(mode);
  if (intent !== null) gridCells.enter({ instance: intent.instance, slug: intent.slug }); // the home cell: the page starts inside it
  if (intent !== null) {
    const target = intent;
    const assembly = new GridAssembly(gridMode(DEVSERVER));
    const home = assembly.cells.find(cell => cell.instance === target.instance && [target.slug].includes(cell.slug));
    if (home === undefined) throw new Error('Grid entry intent has no current catalogue cell');
    const road = recovery?.road ?? safeGridRecovery(assembly, Date.now()).road;
    // The live session replaces this initial capture once it owns real position/save state.
    // A stale product or module can request a planned reload before that session exists.
    registerBeforeReload(pageScope, reason => gridRecovery(saves).write(assembly, home, road, reason));
  }
  if (mode === 'grid' && typeof history !== 'undefined') {
    try { history.replaceState(history.state, '', new URL(location.pathname, location.origin)); } catch { /* a sandboxed frame: the URL stays */ }
  }
  return mode;
}


/** The title page's boot: a stale intent is consumed and dropped, never kept for a later page. */
export function dropGridIntent(): void {
  try { pageGridIntents().consume(''); } catch { /* nothing to drop */ }
}

/** Page-local selection is installed explicitly by the composition root, never by importing this module. */
let selected: NonNullable<GridRecoveryRecord> | null = null;
let refused = false;
let loop = false;

/** A validated current catalogue's default home and road lane, used when recovery metadata is unsafe. */
export function safeGridRecovery(assembly: GridAssembly, now: number): NonNullable<GridRecoveryRecord> {
  const home = assembly.at(0, 0);
  if (home === undefined) throw new Error('Recovery catalogue requires a home cell');
  return { instance: home.instance, slug: home.slug, catalogue: recoveryCatalogue(assembly), at: now, reason: 'gpu',
    road: { x: home.origin.x + assembly.pitch / 2 + 3.6, z: home.origin.z, yaw: 0 } };
}

/** Consume recovery metadata before routing/hydration; ordinary boot and unsupported future records select nothing. */
export function consumeGridRecovery(options: { assembly?: GridAssembly; saves?: SaveStore; now?: () => number; unexpected?: boolean;
  previous?: LastEnd; search?: URLSearchParams } = {}): NonNullable<GridRecoveryRecord> | null {
  const assembly = options.assembly ?? new GridAssembly(gridMode(DEVSERVER));
  const now = options.now ?? Date.now;
  const store = options.saves ?? saves, service = gridRecovery(store, now);
  if (options.previous?.reload === true) {
    const discarded = service.consume(assembly);
    if (discarded.kind !== 'refused') service.clearLoop();
    selected = null; loop = false; refused = discarded.kind === 'refused';
    return null;
  }
  if (options.previous?.kind === 'unexpected' && options.previous.mode === 'grid') service.restoreLast(assembly);
  let result = service.consume(assembly, options.unexpected);
  const end = options.previous, search = options.search;
  // Older clients consumed their grid intent and cleared chunk before product admission.
  // Only their exact planned stale-product reload can use the original grid-mode
  // record or still-pending handoff. Ordinary titles, crashes and explicit shard URLs cannot.
  if (result.kind === 'none' && end?.kind === 'intentional' && !end.discarded && (end.mode === '' || end.mode === 'grid')
    && end.reason === 'stuck boot recovery (app older than its product)' && Number.isFinite(end.at)
    && now() >= end.at && now() - end.at <= 60_000 && search?.size === 1 && search.has('v')) {
    const home = assembly.at(0, 0);
    // A later old-client admission already consumed both handoffs but recorded
    // its actual grid mode. That concrete lifecycle record is the authority.
    let grid = end.mode === 'grid';
    if (!grid && home !== undefined && pendingTitleArrival(home.slug)?.mode === 'enter') {
      const handoff = travelSlot(store).peek();
      grid = handoff !== null && [home.slug].includes(handoff.to) && handoff.from === null && handoff.mode === 'enter'
        && handoff.arrive === null && handoff.carry.length === 0 && freshPageArrival(handoff.at, now());
    }
    if (grid && home !== undefined) {
      const road = safeGridRecovery(assembly, now()).road;
      if (service.write(assembly, home, road, 'reload')) result = service.consume(assembly);
    }
  }
  loop = result.kind === 'loop';
  refused = result.kind === 'refused' || loop;
  selected = result.kind === 'resume' ? result.record : result.kind === 'fallback' ? safeGridRecovery(assembly, now()) : null;
  return selected;
}

/** Same-document handoff to ordinary admission and the live road placement; progress is read from real saves. */
export function pageGridRecovery(): NonNullable<GridRecoveryRecord> | null { return selected; }

/** The compiler ledger may inspect a fresh tap without consuming its authority. */
export function pendingGridEntry(slug: string): boolean { return pageGridIntents().pending(slug); }
/** A failed recovery boot returns to the title and must not supply a selection to another boot. */
export function clearGridRecovery(): void { selected = null; refused = false; loop = false; }
/** Future or unconsumed metadata cannot enter a renderer on this boot. */
export function gridRecoveryRefused(): boolean { return refused; }
/** A repeated failing recovery opens the existing shard picker, never another automatic boot. */
export function gridRecoveryLoop(): boolean { return loop; }

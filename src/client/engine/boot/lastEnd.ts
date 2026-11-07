import { pageScope } from '../../../shared/engine/app/resources';
import type { Scope } from '../../../shared/engine/app/scope';
import { saveStorage } from '../saves/slots';
/**
 * Why the last page ended (E179). Jake's iPhone lost Pine Hollow on an ENTER WORLD: the Debug readout went from two
 * resident shards to "nalati-grasslands (playing)" alone, so the page had reloaded, and nothing said whether the game
 * navigated or the page ended abruptly. This module records the observable exit path:
 *
 *   markUnload('build pill tap')   before EVERY navigation / reload the game makes on purpose: localStorage
 *                                  `life.lastUnload` = { reason, t, build, slug, resident, mode }
 *   the alive beat                 every BEAT_MS, sessionStorage `life.alive` = { t, build, slug, resident, mode, vis };
 *                                  cleared on pagehide (a page that ends normally says so)
 *   lastEnd()                      read once at import (the boot's first module): how the previous page in this tab ended
 *     intentional   a `life.lastUnload` younger than INTENT_MS: the game navigated, and says why
 *     unexpected    no recent reason but a stale `life.alive`: the page ended without a pagehide; browser/system cause unknown
 *     fresh         neither: a cold launch
 *   `document.wasDiscarded` rides along (Chrome's tab discarding; iOS never sets it).
 *
 * The last non-fresh end is kept in localStorage `life.lastEnd`, so pause ▸ Settings ▸ Debug ▸ Loading & memory can show it
 * ("Last reload: …", src/client/engine/ui/Menu.ts) even after a later cold launch. Dependency-free: src/client/engine/boot/sw.ts and src/client/app/entry.ts
 * import it before the game's graph, so its listeners and its timer are the page's, never a shard's.
 *
 *   setAliveSource(() => ({ slug, resident: 'pine-hollow (playing) 178 MB · nalati-grasslands 87 MB', mode: 'shard' }))   // session.ts
 */
import { inspectPreviousBoot, markBootPlanned, previousBootLine } from './bootTrace';

declare const __BUILD_ID__: string;

const UNLOAD_KEY = 'life.lastUnload';
const ALIVE_KEY = 'life.alive';
const ALIVE_BACKUP_KEY = 'life.alive.once';
const END_KEY = 'life.lastEnd';
/** a reason written this long before the next boot still explains it */
const INTENT_MS = 10_000;
/** the alive beat's period */
const BEAT_MS = 3000;

/** what the running page is: its level, the resident list and the game's page mode (SF21a: the game's `'grid' | 'shard'`,
 *  src/client/game/plugin/context.ts), so the next boot knows which way in ended */
export interface AliveInfo<M extends string = string> { slug: string; resident: string; mode: M }
interface Stamp { t: number; build: string; slug: string; resident: string; mode: string }
interface Unload extends Stamp { reason: string; reload?: true }
interface Alive extends Stamp { vis: string }
export interface LastEnd {
  kind: 'intentional' | 'unexpected' | 'fresh';
  /** what ended it, in words */
  reason: string;
  /** when the old page ended (its reason's stamp, or its last beat), epoch ms; 0 for a fresh launch */
  at: number;
  /** what was resident then ('' unknown) */
  resident: string;
  /** the world that page had selected (AliveInfo.slug; '' unknown) */
  slug: string;
  /** the page mode the game reported then (AliveInfo.mode; '' unknown) */
  mode: string;
  /** the build that page ran */
  build: string;
  /** when the page this describes booted (epoch ms) */
  bootedAt: number;
  /** `document.wasDiscarded` at this boot */
  discarded: boolean;
  /** the navigation type of this boot (navigate / reload / back_forward) */
  nav: string;
  /** Explicit RELOAD returns to the title; GPU/background recovery is separate. */
  reload?: true;
}
/** Content supplies persistence at explicit reload boundaries, never at ordinary navigation. */
export type ReloadReason = 'reload' | 'gpu' | 'background' | 'new-game';

/** `<sha>-<stamp>` → the sha, else the stamp (a Vercel CLI build has no commit): the build pill's short id (src/client/engine/ui/Update.ts) */
const build = (): string => { try { const [sha = '', time = ''] = __BUILD_ID__.split('-'); return sha.length >= 7 ? sha : time; } catch { return ''; } };
const store = (kind: 'local' | 'session'): ReturnType<typeof saveStorage> | null => saveStorage(kind === 'local' ? 'device' : 'session');
const readJson = (s: ReturnType<typeof saveStorage> | null, key: string): unknown => { try { const v = s?.getItem(key); return v === null || v === undefined ? null : JSON.parse(v) as unknown; } catch { return null; } };
const writeJson = (s: ReturnType<typeof saveStorage> | null, key: string, v: unknown): void => { try { s?.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked: this record is lost */ } };
const str = (o: unknown, k: string): string => { const v: unknown = typeof o === 'object' && o !== null ? Reflect.get(o, k) : undefined; return typeof v === 'string' ? v : ''; };
const num = (o: unknown, k: string): number => { const v: unknown = typeof o === 'object' && o !== null ? Reflect.get(o, k) : undefined; return typeof v === 'number' && Number.isFinite(v) ? v : 0; };

/** a page (not a unit test's node, which imports the modules that import this one) */
const inPage = (): boolean => typeof document !== 'undefined' && typeof window !== 'undefined';

/**
 * One page's life record: built at boot, it reads how the previous page ended, then beats while this one lives. The page
 * has one (below, on the page scope); a test builds one per simulated page load instead of reloading the module (E422).
 */
export class PageLife {
  private source: (() => AliveInfo) | null = null;
  private alive = true;
  private readonly thisEnd: LastEnd;
  private beforeReload: ((reason: ReloadReason) => boolean) | undefined;
  private readonly storage: typeof store;

  constructor(scope: Scope, storage: typeof store = store) {
    this.storage = storage;
    this.thisEnd = this.classify();
    inspectPreviousBoot();
    if (this.thisEnd.kind !== 'fresh' || this.thisEnd.discarded) writeJson(this.storage('local'), END_KEY, this.thisEnd);
    if (this.thisEnd.kind !== 'fresh') console.info(`[lastEnd] the previous page: ${this.thisEnd.reason}${this.thisEnd.resident === '' ? '' : ` · resident ${this.thisEnd.resident}`}`);
    // the beat: the page's own timer (this module loads before any shard scope exists)
    if (inPage()) {
      this.beat();
      scope.interval(BEAT_MS, () => { this.beat(); });
      // back on screen after a pagehide that did not end the page (iOS can send one on an app switch): beating again
      scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') this.alive = true; this.beat(); });
      // a page that ends normally takes its marker with it; a bfcache return (pageshow persisted) puts it back
      scope.listen(window, 'pagehide', () => { this.alive = false; this.clearAlive(); });
      scope.listen(window, 'pageshow', (e) => { if (e.persisted) { this.alive = true; this.beat(); } });
    }
  }

  /** what the alive beat and markUnload record: the running shard and the resident list (main.ts, once the host exists) */
  setAliveSource(fn: () => AliveInfo): void { this.source = fn; this.beat(); }

  private stamp(): Stamp {
    let info: AliveInfo = { slug: '', resident: '', mode: '' };
    try { if (this.source) info = this.source(); } catch { /* recorded without it */ }
    return { t: Date.now(), build: build(), slug: info.slug, resident: info.resident, mode: info.mode };
  }

  /** the game is about to navigate / reload on purpose: say why, first (the next boot reads it) */
  markUnload(reason: string, reload = false): void {
    markBootPlanned();
    this.alive = false; this.clearAlive();
    const u: Unload = { reason, ...this.stamp(), ...(reload ? { reload: true } : {}) };
    writeJson(this.storage('local'), UNLOAD_KEY, u);
    console.info(`[lastEnd] unloading: ${reason}`);
  }

  /** Scoped replacement restores its prior capture port; imports alone never install one. */
  registerBeforeReload(scope: Scope, capture: (reason: ReloadReason) => boolean): void {
    if (scope.disposed) throw new Error('Reload capture owner is disposed');
    const prior = this.beforeReload;
    const installed = (reason: ReloadReason): boolean => scope.disposed || capture(reason);
    this.beforeReload = installed;
    scope.onDispose(() => { if (this.beforeReload === installed) this.beforeReload = prior; });
  }

  /** Capture content's last durable location before an engine reload; a refusal still allows the title route. */
  markReload(message: string, reason: ReloadReason = 'reload'): boolean {
    let saved: boolean;
    try { saved = this.beforeReload?.(reason) ?? true; }
    catch { saved = false; }
    this.markUnload(message, reason === 'reload');
    return saved;
  }

  private beat(): void {
    if (!this.alive) return;
    if (!inPage()) return;
    const a: Alive = { ...this.stamp(), vis: document.visibilityState };
    writeJson(this.storage('session'), ALIVE_KEY, a);
    // A killed iOS WebContent process may lose sessionStorage too. Normal
    // navigation clears both copies; a kill cannot run that cleanup.
    writeJson(this.storage('local'), ALIVE_BACKUP_KEY, a);
  }

  private clearAlive(): void {
    try { this.storage('session')?.removeItem(ALIVE_KEY); } catch { /* storage blocked */ }
    try { this.storage('local')?.removeItem(ALIVE_BACKUP_KEY); } catch { /* storage blocked */ }
  }

  private classify(): LastEnd {
    const now = Date.now();
    const local = this.storage('local'), session = this.storage('session');
    const u = readJson(local, UNLOAD_KEY), a = readJson(session, ALIVE_KEY) ?? readJson(local, ALIVE_BACKUP_KEY);
    try { local?.removeItem(ALIVE_BACKUP_KEY); } catch { /* consumed by this page's classification */ }
    try { local?.removeItem(UNLOAD_KEY); } catch { /* read once either way */ }
    const discarded = inPage() && Reflect.get(document, 'wasDiscarded') === true;
    let nav = '';
    try { const e: unknown = performance.getEntriesByType('navigation')[0]; nav = str(e, 'type'); } catch { /* old WebKit */ }
    const base = { bootedAt: now, discarded, nav, ...(typeof u === 'object' && u !== null && Reflect.get(u, 'reload') === true ? { reload: true as const } : {}) };
    const ut = num(u, 't');
    if (u !== null && now - ut < INTENT_MS) return { kind: 'intentional', reason: str(u, 'reason'), at: ut, resident: str(u, 'resident'), slug: str(u, 'slug'), mode: str(u, 'mode'), build: str(u, 'build'), ...base };
    if (a !== null) {
      const where = str(a, 'vis') === 'hidden' ? 'in the background' : 'on screen';
      return { kind: 'unexpected', reason: `page ended unexpectedly ${where} (browser or system cause unknown)`, at: num(a, 't'), resident: str(a, 'resident'), slug: str(a, 'slug'), mode: str(a, 'mode'), build: str(a, 'build'), ...base };
    }
    if (u !== null) return { kind: 'intentional', reason: `${str(u, 'reason')} (${Math.round((now - ut) / 1000)} s before this load)`, at: ut, resident: str(u, 'resident'), slug: str(u, 'slug'), mode: str(u, 'mode'), build: str(u, 'build'), ...base };
    return { kind: 'fresh', reason: 'fresh launch', at: 0, resident: '', slug: '', mode: '', build: '', ...base };
  }

  /** how the previous page in this tab ended (this boot's reading) */
  lastEnd(): LastEnd { return this.thisEnd; }

  /** the latest non-fresh end on this device (this boot's, or an earlier one's), null if none was ever recorded */
  lastRecordedEnd(): LastEnd | null {
    if (this.thisEnd.kind !== 'fresh') return this.thisEnd;
    const e = readJson(this.storage('local'), END_KEY);
    if (e === null) return null;
    const kind = str(e, 'kind');
    return {
      kind: kind === 'intentional' || kind === 'unexpected' ? kind : 'fresh', reason: str(e, 'reason'), at: num(e, 'at'), resident: str(e, 'resident'), slug: str(e, 'slug'), mode: str(e, 'mode'),
      build: str(e, 'build'), bootedAt: num(e, 'bootedAt'), discarded: Reflect.get(e as object, 'discarded') === true, nav: str(e, 'nav'),
      ...(Reflect.get(e as object, 'reload') === true ? { reload: true } : {}),
    };
  }

  /** the Debug readout's line: "Last reload: <reason> · 2 min ago · resident <list>" */
  lastEndLine(now: number = Date.now()): string {
    const e = this.lastRecordedEnd();
    if (e === null) return previousBootLine() || 'Last reload: none recorded';
    const ago = (ms: number): string => (ms < 90_000 ? `${Math.max(0, Math.round(ms / 1000))} s ago` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min ago` : `${Math.round(ms / 3_600_000)} h ago`);
    const when = e.at > 0 ? ago(now - e.at) : ago(now - e.bootedAt);
    const was = e === this.thisEnd ? '' : ' (before an earlier launch)';
    const abrupt = previousBootLine();
    return `Last reload: ${e.reason}${was} · ${when}${e.resident === '' ? '' : ` · resident ${e.resident}`}${e.build === '' ? '' : ` · build ${e.build}`}${e.discarded ? ' · wasDiscarded' : ''}${e.nav === '' ? '' : ` · nav ${e.nav}`}${abrupt ? `\n${abrupt}` : ''}`;
  }
}

/** this page's life record (the page scope) */
const page = new PageLife(pageScope);
export function setAliveSource(fn: () => AliveInfo): void { page.setAliveSource(fn); }
export function markUnload(reason: string): void { page.markUnload(reason); }
/** All engine reload actions share this persistence boundary; explicit navigation remains markUnload. */
export function markReload(message: string, reason: ReloadReason = 'reload'): boolean { return page.markReload(message, reason); }
/** Install the content-owned durable capture port for the current play scope. */
export function registerBeforeReload(scope: Scope, capture: (reason: ReloadReason) => boolean): void { page.registerBeforeReload(scope, capture); }
/** How long a page waits on a server's save before it leaves anyway: a stalled server must never hold a player in a world they left. */
const LEAVE_WAIT_MS = 4000;
let saver: (() => Promise<unknown>) | null = null;
/** `work`, or `LEAVE_WAIT_MS`, whichever ends first. */
export function atMostLeaveWait(work: Promise<unknown>): Promise<void> {
  return new Promise(resolve => {
    const timer = pageScope.timeout(LEAVE_WAIT_MS, resolve);
    void work.catch(() => undefined).finally(() => { pageScope.cancelTimer(timer); resolve(); });
  });
}
/** A session whose progress lives across a port: nothing written at pagehide reaches a page that's going, so a page asks before it goes. */
export function holdLeaving(save: () => Promise<unknown>): () => void {
  saver = save;
  return () => { if (saver === save) saver = null; };
}
/** Run a navigation the game chose, once what a held session has made is durable. With nothing held this is the navigation, now. */
export function leaveSaved(go: () => void): void {
  if (saver === null) { go(); return; }
  const save = saver;
  saver = null; // a second tap goes the same way, and doesn't save or wait twice
  void atMostLeaveWait(save()).then(go);
}
export function lastEnd(): LastEnd { return page.lastEnd(); }
export function lastRecordedEnd(): LastEnd | null { return page.lastRecordedEnd(); }
export function lastEndLine(now: number = Date.now()): string { return page.lastEndLine(now); }

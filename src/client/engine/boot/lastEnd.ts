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
 *     intentional   (player) neither, on a `reload` navigation of a page that ended VISIBLE moments ago (session `life.hid`,
 *                   written at pagehide): the player reloaded (browser button, pull-to-refresh); it carries `reload` and
 *                   `player`, so it lands on a quiet title (QA 11-12 row 35). A system reload is not one: a discarded tab, or an
 *                   iOS tab killed in the background (its pagehide ran hidden). index.html's 12 s self-reload (`boot.selfReload`,
 *                   claimed just before this document) is the engine's and resumes, unless it retried a hung player reload
 *     fresh         neither: a cold launch
 *   settleLastEnd()                SENTRY-TRIAGE S20: a new tab has no session copy, so it reads the device copy, which may be
 *                                  another tab's live beat (a duplicated tab's session copy is one too). Each page holds a Web Lock
 *                                  named for its page id (on the beat) while it is shown; an end that rests on a beat stays pending
 *                                  until a lock query says whether that page still lives (then `fresh`, and its beat is left alone).
 *                                  The entry awaits it before the title reads lastEnd().
 *   `document.wasDiscarded` rides along (Chrome's tab discarding; iOS never sets it).
 *
 * The last non-fresh end is kept in localStorage `life.lastEnd`, so pause ▸ Settings ▸ Debug ▸ Loading & memory can show it
 * ("Last reload: …", src/client/engine/ui/Menu.ts) even after a later cold launch. Dependency-free: src/client/engine/boot/sw.ts and src/client/app/entry.ts
 * import it before the game's graph, so its listeners and its timer are the page's, never a shard's.
 *
 *   setAliveSource(() => ({ slug, resident: 'pine-hollow (playing) 178 MB · nalati-grasslands 87 MB', mode: 'shard' }))   // session.ts
 */
import { inspectPreviousBoot, markBootPlanned, previousBootLine } from './bootTrace';
import { noteDropRoute } from './dropNotice';

declare const __BUILD_ID__: string;

const UNLOAD_KEY = 'life.lastUnload';
const ALIVE_KEY = 'life.alive';
const ALIVE_BACKUP_KEY = 'life.alive.once';
const END_KEY = 'life.lastEnd';
/** a reason written this long before the next boot still explains it */
const INTENT_MS = 10_000;
/** the alive beat's period */
const BEAT_MS = 3000;
/** index.html's 12 s self-reload claims session `boot.selfReload` (a timestamp) just before it reloads: that young, it is the engine's */
const SELF_RELOAD_KEY = 'boot.selfReload';
/** a claim this long before this document's start is the reload that started it (it is written in the same turn as the reload) */
const SELF_RELOAD_MS = 3000;
/** the last pagehide in this tab: when, visible or hidden, and the address (session) */
const HID_KEY = 'life.hid';
/** a reload button or pull-to-refresh boots the next page this soon after the old one's pagehide */
const PLAYER_RELOAD_MS = 30_000;
/** index.html's self-reload of a hung player reload: its own 12 s on top */
const PLAYER_RETRY_MS = 60_000;

/** what the running page is: its level, the resident list and the game's page mode (SF21a: the game's `'grid' | 'shard'`,
 *  src/client/game/plugin/context.ts), so the next boot knows which way in ended */
export interface AliveInfo<M extends string = string> { slug: string; resident: string; mode: M }
interface Stamp { t: number; build: string; slug: string; resident: string; mode: string }
interface Unload extends Stamp { reason: string; reload?: true }
interface Alive extends Stamp { vis: string; page?: string }
/** S20: a Web Lock each shown page holds, named for its page id, so another tab can ask whether the page behind a device beat
 *  still lives. `hold` returns the release. */
export interface PageLocks { hold: (name: string) => () => void; held: (name: string) => Promise<boolean> }
const PAGE_LOCK = 'ws-page:';
/** a lock query this slow answers "not held": the end stays what the beat said */
const SETTLE_MS = 500;
function browserLocks(): PageLocks | null {
  // an old Safari, an insecure page or a test DOM may have none, or null
  const locks: LockManager | null | undefined = typeof navigator === 'undefined' ? undefined : (navigator as { locks?: LockManager | null }).locks;
  if (locks === undefined || locks === null || typeof locks.request !== 'function' || typeof locks.query !== 'function') return null;
  return {
    hold: (name) => {
      let release = (): void => undefined;
      const held = new Promise<void>((resolve) => { release = resolve; });
      void locks.request(name, () => held).catch(() => undefined);
      return release;
    },
    // a request not yet granted is a live page too (a first beat, a bfcache return, both before the grant)
    held: async (name) => { const state = await locks.query(); return [...(state.held ?? []), ...(state.pending ?? [])].some((lock) => lock.name === name); },
  };
}
/** Web Locks need a secure context, which always has randomUUID; without one the beat carries no id and reads as before */
const newPageId = (): string => { try { return crypto.randomUUID(); } catch { return ''; } };
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
  /** QA 11-12 row 35 (Jake: "I expected reload to go back to main menu"): the player reloaded the page themselves (the browser's
   *  reload button, pull-to-refresh), with no word from the game. It lands on the title, and the title shows no drop modal. */
  player?: true;
}
/** Content supplies persistence at explicit reload boundaries, never at ordinary navigation. `settings`: a Settings pick
 *  reloads back into the world where the player stands (SETTINGS-REDESIGN SR12); unlike `reload` it does not return to the title. */
export type ReloadReason = 'reload' | 'settings' | 'gpu' | 'background' | 'new-game';

/** `<sha>-<stamp>` → the sha, else the stamp (a build outside a git checkout has no commit): the build pill's short id (src/client/engine/ui/Update.ts) */
const build = (): string => { try { const [sha = '', time = ''] = __BUILD_ID__.split('-'); return sha.length >= 7 ? sha : time; } catch { return ''; } };
const store = (kind: 'local' | 'session'): ReturnType<typeof saveStorage> | null => saveStorage(kind === 'local' ? 'device' : 'session');
const readJson = (s: ReturnType<typeof saveStorage> | null, key: string): unknown => { try { const v = s?.getItem(key); return v === null || v === undefined ? null : JSON.parse(v) as unknown; } catch { return null; } };
const writeJson = (s: ReturnType<typeof saveStorage> | null, key: string, v: unknown): void => { try { s?.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked: this record is lost */ } };
const str = (o: unknown, k: string): string => { const v: unknown = typeof o === 'object' && o !== null ? Reflect.get(o, k) : undefined; return typeof v === 'string' ? v : ''; };
const num = (o: unknown, k: string): number => { const v: unknown = typeof o === 'object' && o !== null ? Reflect.get(o, k) : undefined; return typeof v === 'number' && Number.isFinite(v) ? v : 0; };

/** a page (not a unit test's node, which imports the modules that import this one) */
const inPage = (): boolean => typeof document !== 'undefined' && typeof window !== 'undefined';
/** this document's navigation type (navigate / reload / back_forward), '' unknown; WebKit before Navigation Timing 2 has only
 *  the legacy `performance.navigation.type` (1 = reload) */
function navigationType(): string {
  try {
    const entry: unknown = performance.getEntriesByType('navigation')[0];
    if (entry !== undefined) return str(entry, 'type');
    const legacy: unknown = Reflect.get(performance, 'navigation');
    return num(legacy, 'type') === 1 ? 'reload' : '';
  } catch { return ''; }
}

/**
 * One page's life record: built at boot, it reads how the previous page ended, then beats while this one lives. The page
 * has one (below, on the page scope); a test builds one per simulated page load instead of reloading the module (E422).
 */
export class PageLife {
  private source: (() => AliveInfo) | null = null;
  private alive = true;
  private thisEnd: LastEnd;
  /** S20: this page's id, on its beat and its Web Lock */
  private readonly id = newPageId();
  private readonly locks: PageLocks | null;
  private readonly scope: Scope;
  private releaseLock: (() => void) | null = null;
  /** S20: the page id of a device beat this end rests on alone, until settle() asks whether it lives */
  private pendingPage: string | null = null;
  private settling: Promise<LastEnd> | undefined;
  private beforeReload: ((reason: ReloadReason) => boolean) | undefined;
  private readonly storage: typeof store;
  private readonly nav: () => string;

  private readonly page: () => { href: string; startedAt: number };

  constructor(scope: Scope, storage: typeof store = store, nav: () => string = navigationType,
    page: () => { href: string; startedAt: number } = () => ({ href: inPage() ? location.href : '', startedAt: typeof performance === 'undefined' ? Date.now() : performance.timeOrigin }),
    locks: PageLocks | null = browserLocks()) {
    this.storage = storage;
    this.locks = locks;
    this.scope = scope;
    this.nav = nav;
    this.page = page;
    this.thisEnd = this.classify();
    // S18: a reload the page before marked is never index.html's self-reload
    inspectPreviousBoot(this.thisEnd.kind === 'intentional' && this.thisEnd.player !== true && this.thisEnd.bootedAt - this.thisEnd.at < INTENT_MS);
    if (this.pendingPage === null) this.record();
    this.holdLock();
    // the beat: the page's own timer (this module loads before any shard scope exists)
    if (inPage()) {
      this.beat();
      scope.interval(BEAT_MS, () => { this.beat(); });
      // back on screen after a pagehide that did not end the page (iOS can send one on an app switch): beating again
      scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') { this.alive = true; this.holdLock(); } this.beat(); });
      // a page that ends normally takes its marker with it; a bfcache return (pageshow persisted) puts it back
      scope.listen(window, 'pagehide', () => {
        this.alive = false; this.clearAlive(); this.dropLock();
        // QA 11-12 row 35: how this page ended, for telling the player's reload (a visible page) from a system one (hidden)
        writeJson(this.storage('session'), HID_KEY, { t: Date.now(), vis: document.visibilityState, href: location.href });
      });
      scope.listen(window, 'pageshow', (e) => { if (e.persisted) { this.alive = true; this.holdLock(); this.beat(); } });
    }
    scope.onDispose(() => { this.dropLock(); });
  }

  /** the device's last-end record and the console line, once the end is known */
  private record(): void {
    if (this.thisEnd.kind !== 'fresh' || this.thisEnd.discarded) writeJson(this.storage('local'), END_KEY, this.thisEnd);
    if (this.thisEnd.kind !== 'fresh') console.info(`[lastEnd] the previous page: ${this.thisEnd.reason}${this.thisEnd.resident === '' ? '' : ` · resident ${this.thisEnd.resident}`}`);
  }

  /** S20: held while this page is shown; a pagehide lets it go (a held lock would keep the page out of the bfcache) */
  private holdLock(): void { if (this.locks !== null && this.id !== '' && this.releaseLock === null) this.releaseLock = this.locks.hold(PAGE_LOCK + this.id); }
  private dropLock(): void { this.releaseLock?.(); this.releaseLock = null; }

  /** S20: an end that rests on a device beat alone is `fresh` when that beat's page still holds its lock (another tab, playing);
   *  else it stands, and the beat is cleared as the classification would have. Once; at most SETTLE_MS. */
  settle(): Promise<LastEnd> {
    this.settling ??= (async () => {
      const id = this.pendingPage, locks = this.locks;
      if (id === null || locks === null) return this.thisEnd;
      let alive = false;
      try {
        let timer: ReturnType<Scope['timeout']> | undefined;
        const late = new Promise<boolean>((resolve) => { timer = this.scope.timeout(SETTLE_MS, () => { resolve(false); }); });
        alive = await Promise.race([locks.held(PAGE_LOCK + id).catch(() => false), late]);
        if (timer !== undefined) this.scope.cancelTimer(timer);
      } catch { /* not settled: the beat's word stands */ }
      this.pendingPage = null;
      if (alive) {
        const { bootedAt, discarded, nav } = this.thisEnd;
        this.thisEnd = { kind: 'fresh', reason: 'fresh launch (another tab is playing)', at: 0, resident: '', slug: '', mode: '', build: '', bootedAt, discarded, nav };
      } else this.dropBeat(id);
      this.record();
      return this.thisEnd;
    })();
    return this.settling;
  }

  /** what the alive beat and markUnload record: the running shard and the resident list (main.ts, once the host exists) */
  setAliveSource(fn: () => AliveInfo): void { this.source = fn; this.beat(); }

  private stamp(): Stamp {
    let info: AliveInfo = { slug: '', resident: '', mode: '' };
    try { if (this.source) info = this.source(); } catch { /* recorded without it */ }
    return { t: Date.now(), build: build(), slug: info.slug, resident: info.resident, mode: info.mode };
  }

  /** the game is about to navigate / reload on purpose: say why, first (the next boot reads it) */
  /** KP4: when this page last said it is leaving on purpose (Date.now), read by the leave guard */
  leftOnPurposeAt: number = Number.NEGATIVE_INFINITY;
  markUnload(reason: string, reload = false): void {
    this.leftOnPurposeAt = Date.now();
    markBootPlanned();
    noteDropRoute(reason); // the title's drop modal names the words and the call site of the game's last navigation
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
    const a: Alive = { ...this.stamp(), vis: document.visibilityState, ...(this.id === '' ? {} : { page: this.id }) };
    writeJson(this.storage('session'), ALIVE_KEY, a);
    // A killed iOS WebContent process may lose sessionStorage too. Normal
    // navigation clears both copies; a kill cannot run that cleanup.
    writeJson(this.storage('local'), ALIVE_BACKUP_KEY, a);
  }

  /** the device beat of page `id`, consumed by this page's classification; once this page beats, the copy is its own and stays */
  private dropBeat(id: string): void {
    if (id === '') return;
    try { const local = this.storage('local'); if (str(readJson(local, ALIVE_BACKUP_KEY), 'page') === id) local?.removeItem(ALIVE_BACKUP_KEY); } catch { /* storage blocked */ }
  }

  private clearAlive(): void {
    try { this.storage('session')?.removeItem(ALIVE_KEY); } catch { /* storage blocked */ }
    try { this.storage('local')?.removeItem(ALIVE_BACKUP_KEY); } catch { /* storage blocked */ }
  }

  private classify(): LastEnd {
    const now = Date.now();
    const local = this.storage('local'), session = this.storage('session');
    const u = readJson(local, UNLOAD_KEY), a = readJson(session, ALIVE_KEY) ?? readJson(local, ALIVE_BACKUP_KEY);
    // S20: a beat from a page with an id may be another tab's live one: the device copy in a new tab, or the session copy a
    // duplicated tab (or a window.open) starts with. settle() asks before it is taken; a page of this tab can't be alive.
    const otherPage = this.locks !== null ? str(a, 'page') : '';
    if (otherPage === '') try { local?.removeItem(ALIVE_BACKUP_KEY); } catch { /* consumed by this page's classification */ }
    try { local?.removeItem(UNLOAD_KEY); } catch { /* read once either way */ }
    const discarded = inPage() && Reflect.get(document, 'wasDiscarded') === true;
    const nav = this.nav(), hid = readJson(session, HID_KEY);
    try { session?.removeItem(HID_KEY); } catch { /* read once either way */ }
    const base = { bootedAt: now, discarded, nav, ...(typeof u === 'object' && u !== null && Reflect.get(u, 'reload') === true ? { reload: true as const } : {}) };
    const ut = num(u, 't');
    if (u !== null && now - ut < INTENT_MS) { this.dropBeat(otherPage); return { kind: 'intentional', reason: str(u, 'reason'), at: ut, resident: str(u, 'resident'), slug: str(u, 'slug'), mode: str(u, 'mode'), build: str(u, 'build'), ...base }; }
    if (a !== null) {
      if (otherPage !== '') this.pendingPage = otherPage;
      const where = str(a, 'vis') === 'hidden' ? 'in the background' : 'on screen';
      return { kind: 'unexpected', reason: `page ended unexpectedly ${where} (browser or system cause unknown)`, at: num(a, 't'), resident: str(a, 'resident'), slug: str(a, 'slug'), mode: str(a, 'mode'), build: str(a, 'build'), ...base };
    }
    if (u !== null) return { kind: 'intentional', reason: `${str(u, 'reason')} (${Math.round((now - ut) / 1000)} s before this load)`, at: ut, resident: str(u, 'resident'), slug: str(u, 'slug'), mode: str(u, 'mode'), build: str(u, 'build'), ...base };
    // no word from the game and no crash, on a reload: the player's own (browser button, pull-to-refresh), unless index.html's self-reload claimed it
    if (this.playerReload(nav, hid, discarded, now)) return { kind: 'intentional', reason: 'player reload (the browser reload button or pull-to-refresh)', at: now, resident: '', slug: '', mode: '', build: '', ...base, reload: true, player: true };
    return { kind: 'fresh', reason: 'fresh launch', at: 0, resident: '', slug: '', mode: '', build: '', ...base };
  }

  /** QA 11-12 row 35: the player reloaded this page (no word from the game, no crash). The page before ended visible, moments ago
   *  (a system reload ends a hidden page, or a discarded one). A reload index.html made by itself retries the page before it: a
   *  player reload whose boot hung (same address) stays the player's; any other hung boot it retried resumes. */
  private playerReload(nav: string, hid: unknown, discarded: boolean, now: number): boolean {
    if (discarded || nav !== 'reload' || str(hid, 'vis') !== 'visible') return false;
    const age = now - num(hid, 't');
    if (!this.selfReloaded()) return age >= 0 && age < PLAYER_RELOAD_MS;
    return age >= 0 && age < PLAYER_RETRY_MS && str(hid, 'href') !== '' && str(hid, 'href') === this.page().href;
  }

  /** index.html's self-reload claimed `boot.selfReload` just before this document started (blocked storage: it could not claim,
   *  and index.html does not reload without one) */
  private selfReloaded(): boolean {
    try {
      const at = Number(this.storage('session')?.getItem(SELF_RELOAD_KEY) ?? Number.NaN), started = this.page().startedAt;
      return Number.isFinite(at) && at <= started + 50 && started - at < SELF_RELOAD_MS;
    } catch { return false; }
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
      ...(Reflect.get(e as object, 'player') === true ? { player: true } : {}),
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
/** KP4: how long a markUnload / markReload keeps the leave guard (src/client/engine/ui/leaveGuard.ts) down; a save before
 *  the navigation waits at most LEAVE_WAIT_MS, so this outlasts it */
export const LEAVE_INTENT_MS = 10_000;
/** KP4: the game said it is leaving (markUnload / markReload) within LEAVE_INTENT_MS: no "Leave site?" for it */
export function leavingOnPurpose(now: number = Date.now()): boolean { return now - page.leftOnPurposeAt < LEAVE_INTENT_MS; }
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
let leaveFirst: (() => Promise<void>) | null = null;
/** A step a navigation the game chose waits for, beside the save (play's back guard steps off its history entry, ui/backGuard.ts). */
export function beforeLeaving(first: (() => Promise<void>) | null): void { leaveFirst = first; }
/** Run a navigation the game chose, once what a held session has made is durable. With nothing held this is the navigation, now. */
export function leaveSaved(go: () => void): void {
  const first = leaveFirst;
  leaveFirst = null;
  if (saver === null && first === null) { go(); return; }
  const save = saver;
  saver = null; // a second tap goes the same way, and doesn't save or wait twice
  void Promise.all([save === null ? undefined : atMostLeaveWait(save()), first?.()]).then(() => go());
}

export function lastEnd(): LastEnd { return page.lastEnd(); }
/** S20: lastEnd() once a device beat it rests on alone is known to be no other tab's live page; the entry awaits it before the title */
export function settleLastEnd(): Promise<LastEnd> { return page.settle(); }
export function lastRecordedEnd(): LastEnd | null { return page.lastRecordedEnd(); }
export function lastEndLine(now: number = Date.now()): string { return page.lastEndLine(now); }

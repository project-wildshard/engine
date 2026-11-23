import { pageScope } from '../../../shared/engine/app/resources';
import type { Scope } from '../../../shared/engine/app/scope';
import { jsonSlot, type Json } from '../saves/slots';
import type { LastEnd } from './lastEnd';
/**
 * The drop notice, an invariant at the title (Jake, 2026-11-12, 17:52: "anything going to the main menu in an uninspected fashion
 * is considered an error … Normal navigation ending on the title screen is not normal navigation"). A title reached from a world
 * page in this tab must carry an explicit token that the player asked for it (their exit, main menu, back or reload button);
 * without one it is an error: the title opens the drop modal (src/client/app/dropModal.ts) and reports it. No exception has to
 * fire first: Brasscap's bounce was a legitimate server `resume` to another shard, then the shell's "elsewhere" navigation.
 *
 *   markDropStep({ world, name, step, arrivedBy })   a world page says where it stands, BEFORE each risky step (sessionStorage,
 *                                                    and a device copy a killed iOS process can't lose). A new world names how
 *                                                    the last page sent it here, so a redirect chain stays on the trail.
 *   noteDropError(error)                 the last error this page saw rides the breadcrumb
 *   noteDropRoute(reason)                every navigation the game makes (lastEnd's markUnload) leaves its words and call site
 *   recordDrop({ what, reason, error })  code that sends the page to the title by itself says why, first
 *   leftByPlayer()                       the player's own exit: the token the next title needs to stay quiet
 *   (a browser reload)                   lastEnd's `player`: the player reloaded the page themselves, also a quiet title
 *   takeDrop(lastEnd())                  the title, once: the drop to show, or null
 *
 * Quiet titles: the token, the first boot of a visit (no world page before it in this tab) and a title after a title. The device
 * copy is read only when lastEnd says the page died, so a cold launch or another tab never shows a stale notice.
 */

declare const __BUILD_ID__: string;

/** what a world page last reached */
export interface DropStep { readonly world: string; readonly name: string; readonly step: string; readonly t: number; readonly build: string;
  /** the last error this page saw before it ended, '' none */
  readonly error: string; readonly errorStack: string;
  /** the last navigation the game made from here: its words and its call site */
  readonly route: string; readonly routeStack: string;
  /** the pages before this one in the chain that brought it here, oldest first */
  readonly trail: readonly string[] }
/** one drop, as the title shows it */
export interface Drop {
  /** 'error': code chose to leave and said why; 'restart': the page ended or reloaded with no word from the player;
   *  'background': the system ended the page while it was hidden (QA-FEEDBACK 11-19 row 11), said calmly */
  readonly kind: 'error' | 'restart' | 'background';
  /** the headline, in plain words: "Couldn't enter Blender Template" */
  readonly what: string;
  /** why, in plain words: "the server closed the connection" */
  readonly reason: string;
  /** the step the world had reached ('' none recorded) */
  readonly step: string;
  readonly world: string;
  readonly name: string;
  /** developer details: the real error */
  readonly message: string;
  readonly code: string;
  readonly stack: string;
  /** how the previous page ended, in lastEnd's words */
  readonly end: string;
  /** the redirect chain that ended here, oldest first: "Blender Template at Joining the world → online seat elsewhere (driftwood-isle)" */
  readonly trail: string;
  /** the call site of the last navigation the game made ('' none) */
  readonly routeStack: string;
  readonly at: number;
  readonly build: string;
  /** J501: the modal offers Retry (endPlay's `retry`); absent: no Retry */
  readonly retry?: boolean;
  /** J501: where play ended, for the modal's details and Sentry's tags ('' or absent: unknown) */
  readonly zone?: string;
  readonly revision?: string;
  readonly room?: string;
}
/** J501: where play ended (src/client/engine/boot/endPlay.ts): Sentry's `zone`, `revision`, `room` and `step` tags */
export interface EndContext {
  readonly zone?: string;
  readonly revision?: string;
  readonly room?: string;
  readonly step?: string;
}
export interface DropInput {
  readonly what?: string;
  readonly reason: string;
  readonly error?: unknown;
  readonly code?: string | number;
  readonly retry?: boolean;
  readonly context?: EndContext;
}
/** the store a DropNotes reads and writes: real save slots on a page, a Map in a test */
export interface DropStore {
  read: (key: DropKey) => Json;
  write: (key: DropKey, value: Json) => void;
  clear: (key: DropKey) => void;
}
type DropKey = 'step' | 'stepOnce' | 'pending' | 'pendingOnce' | 'expect' | 'seen';

/** the step a world page names once it is playing */
export const PLAYING = 'Playing';
/**
 * lastEnd reasons that are the player's own choice (the call sites' markUnload / markReload words): the token's backstop, for a
 * call site that says so only in words. Everything else that reaches the title from a world page is a drop.
 */
/** forceUpdate.ts's reload of a client older than the server's minClient (J383): the game's own, never a drop (STAGING-BUGBASH SB30) */
export const FORCE_UPDATE_RELOAD = 'required client cache update';
export const PLAYER_EXITS: readonly string[] = [FORCE_UPDATE_RELOAD, 'exit to main menu', 'exit to title', 'error modal:', 'update at title', 'update tapped',
  'new game', 'save import', 'debug:', 'tier pick', 'doctor', 'load failure reload', 'pause settings', 'settings', 'reload prompt', 'loading wait retry'];
const TRAIL_MAX = 4;
/** QA-FEEDBACK 11-19 row 11: a drop older than this, or from another build, is history: Jake's v0.1.50 title showed a
 *  v0.1.43 page's background end from the day before. A new session is not greeted with it. */
const DROP_FRESH_MS = 6 * 3_600_000;

/** two worlds that may be the same: an unknown ('') matches either */
const sameWorld = (a: string, b: string): boolean => a === '' || b === '' || a === b;
/** the first non-empty text */
const first = (...texts: readonly (string | undefined)[]): string => texts.find((t) => t !== undefined && t !== '') ?? '';
const build = (): string => { try { return __BUILD_ID__; } catch { return ''; } };
const field = (o: Json, k: string): Json | undefined => (typeof o === 'object' && o !== null && !Array.isArray(o) ? o[k] : undefined);
const text = (o: Json, k: string): string => { const v = field(o, k); return typeof v === 'string' ? v : ''; };
const time = (o: Json, k: string): number => { const v = field(o, k); return typeof v === 'number' && Number.isFinite(v) ? v : 0; };
const texts = (o: Json, k: string): string[] => { const v = field(o, k); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; };

/** an error's message, code and stack, whatever was thrown (an Error, a CloseEvent, a string) */
export function describeDropError(error: unknown): { message: string; code: string; stack: string } {
  if (error === undefined || error === null) return { message: '', code: '', stack: '' };
  if (error instanceof Error) {
    const code: unknown = Reflect.get(error, 'code');
    return { message: `${error.name}: ${error.message}`, code: typeof code === 'string' || typeof code === 'number' ? String(code) : '', stack: error.stack ?? '' };
  }
  if (typeof error === 'object') {
    const code: unknown = Reflect.get(error, 'code'), reason: unknown = Reflect.get(error, 'reason'), message: unknown = Reflect.get(error, 'message');
    const said = typeof message === 'string' ? message : typeof reason === 'string' ? reason : '';
    return { message: said || Object.prototype.toString.call(error), code: typeof code === 'string' || typeof code === 'number' ? String(code) : '', stack: '' };
  }
  return { message: typeof error === 'string' ? error : JSON.stringify(error), code: '', stack: '' };
}

/** The page's drop notes over a store. A test builds one per simulated page load (as lastEnd's PageLife does). */
export class DropNotes {
  private readonly store: DropStore;
  private readonly now: () => number;
  /** J501: this page recorded a drop itself; a step it marks after that (the world reaching Playing as it leaves) keeps it */
  private recordedHere = false;
  constructor(store: DropStore, now: () => number = Date.now) { this.store = store; this.now = now; }

  /** where the world stands now, written before the step runs. Naming the world starts a new page: the page before it goes on
   *  the trail with the words that sent it here (`arrivedBy`, lastEnd's reason). */
  markStep(at: { world?: string; name?: string; step: string; arrivedBy?: string }): void {
    const prior = this.step(false);
    if (at.world === undefined && prior?.step === at.step) return;
    const fresh = at.world !== undefined;
    const hop = prior === null ? '' : `${first(prior.name, prior.world)} at ${prior.step}${at.arrivedBy === undefined || at.arrivedBy === '' ? '' : ` → ${at.arrivedBy}`}`;
    const step: DropStep = {
      world: at.world ?? prior?.world ?? '', name: at.name ?? prior?.name ?? '', step: at.step, t: this.now(), build: build(),
      error: fresh ? '' : prior?.error ?? '', errorStack: fresh ? '' : prior?.errorStack ?? '',
      route: fresh ? '' : prior?.route ?? '', routeStack: fresh ? '' : prior?.routeStack ?? '',
      trail: fresh ? (hop === '' ? [] : [...prior?.trail ?? [], hop].slice(-TRAIL_MAX)) : prior?.trail ?? [],
    };
    this.write('step', 'stepOnce', { ...step, trail: [...step.trail] });
    if (fresh) this.store.clear('expect');
    // the world is up: an older recorded drop is history, not this page's. J501 (WebKit proof, 11-23): a page whose world
    // reached Playing just after it chose to end play wiped its own drop, and the title showed a codeless "Restarted".
    if (at.step === PLAYING && !this.recordedHere) { this.store.clear('pending'); this.store.clear('pendingOnce'); }
  }

  /** the last error this page saw: it names the cause if the page dies next */
  noteError(error: unknown): void {
    const prior = this.step(false);
    if (prior === null) return;
    const d = describeDropError(error), said = `${d.message}${d.code === '' ? '' : ` (code ${d.code})`}`.slice(0, 300);
    if (said === prior.error) return; // an error repeating every frame writes once
    this.write('step', 'stepOnce', { ...prior, trail: [...prior.trail], error: said, errorStack: d.stack.slice(0, 2000) });
  }

  /** a navigation the game makes on purpose: its words and its call site ride the breadcrumb to the next page */
  noteRoute(reason: string, stack: string): void {
    const prior = this.step(false);
    if (prior === null) return;
    this.write('step', 'stepOnce', { ...prior, trail: [...prior.trail], route: reason.slice(0, 300), routeStack: stack.slice(0, 2000) });
  }

  /** the game leaves for the title by itself: say why, first */
  record(input: DropInput): Drop {
    const step = this.step(false), d = describeDropError(input.error), at = input.context ?? {};
    const name = first(step?.name, step?.world, at.zone);
    const drop: Drop = {
      kind: 'error', what: input.what ?? (name === '' ? 'Back at the title' : `Couldn't enter ${name}`), reason: input.reason,
      step: first(at.step, step?.step), world: first(step?.world, at.zone), name, message: first(d.message, step?.error),
      code: input.code === undefined ? d.code : String(input.code), stack: first(d.stack, step?.errorStack), end: '',
      trail: (step?.trail ?? []).join(' → '), routeStack: step?.routeStack ?? '', at: this.now(), build: build(),
      ...(input.retry === true ? { retry: true } : {}),
      ...(first(at.zone, step?.world) === '' ? {} : { zone: first(at.zone, step?.world) }),
      ...(at.revision === undefined || at.revision === '' ? {} : { revision: at.revision }),
      ...(at.room === undefined || at.room === '' ? {} : { room: at.room }),
    };
    this.write('pending', 'pendingOnce', { ...drop });
    this.recordedHere = true;
    return drop;
  }

  /** the player chose to leave: the token the next title needs, and nothing left to explain */
  leftByPlayer(why = 'player'): void {
    // never throws: it runs inside the player's own navigation, which must go ahead whatever storage does
    for (const key of ['step', 'stepOnce', 'pending', 'pendingOnce'] as const) { try { this.store.clear(key); } catch { /* storage blocked */ } }
    try { this.store.write('expect', { why, t: this.now() }); } catch { /* storage blocked: the breadcrumb is gone, so the title stays quiet */ }
  }

  /** what the title shows, once: a recorded drop; else, for a title reached from a world page without the player's token, a drop */
  take(end: LastEnd): Drop | null {
    // the device copies are every tab's: read them only for a page that died (lastEnd's alive beat proves it), and only
    // the copy of the world that page had; a living tab's copies are its own
    const unexpected = end.kind === 'unexpected';
    const pending = this.fresh('pending', 'pendingOnce', unexpected), stepRead = this.step(unexpected);
    const step = stepRead !== null && unexpected && !sameWorld(stepRead.world, end.slug) ? null : stepRead;
    let expected: Json = null;
    try { expected = this.store.read('expect'); } catch { /* storage blocked */ }
    for (const key of unexpected ? ['step', 'pending', 'expect', 'stepOnce', 'pendingOnce'] as const : ['step', 'pending', 'expect'] as const) {
      try { this.store.clear(key); } catch { /* storage blocked */ }
    }
    // QA 11-12 row 35: the player's own browser reload is their token: a quiet title, no modal and no report
    if (end.player === true) return null;
    // SB8: the player left for another page and came back: theirs too
    if (end.left === true) return null;
    const said = end.kind === 'fresh' ? '' : end.reason;
    // row 11: another build's page, or one that ended hours ago, is not this session's to explain
    const current = (at: number, built: string): boolean => (built === '' || built === build()) && (at === 0 || this.now() - at < DROP_FRESH_MS);
    if (pending !== null && !current(time(pending, 'at'), text(pending, 'build'))) return null;
    if (pending !== null && time(pending, 'at') >= time(expected, 't')) {
      return this.once({ kind: 'error', what: text(pending, 'what'), reason: text(pending, 'reason'), step: text(pending, 'step'), world: text(pending, 'world'),
        name: text(pending, 'name'), message: text(pending, 'message'), code: text(pending, 'code'), stack: text(pending, 'stack'), end: said,
        trail: text(pending, 'trail'), routeStack: text(pending, 'routeStack'), at: time(pending, 'at'), build: text(pending, 'build'),
        ...(field(pending, 'retry') === true ? { retry: true } : {}),
        ...(text(pending, 'zone') === '' ? {} : { zone: text(pending, 'zone') }),
        ...(text(pending, 'revision') === '' ? {} : { revision: text(pending, 'revision') }),
        ...(text(pending, 'room') === '' ? {} : { room: text(pending, 'room') }) });
    }
    // the first boot of a visit, and a title after a title: no world page came before it in this tab
    if (step === null) return null;
    if (!current(step.t, step.build)) return null;
    // the player's token (or, for a call site that says so only in words, its reason)
    if (expected !== null && !unexpected) return null;
    if (end.kind === 'intentional' && PLAYER_EXITS.some((exit) => end.reason.startsWith(exit))) return null;
    const name = first(step.name, step.world), trail = step.trail.join(' → ');
    const via = trail === '' ? '' : ` It was sent here by a redirect: ${trail} → ${name} at ${step.step}.`;
    // row 11: the system ended the page while it was hidden (an app switch, the lock button): calm words, still reported
    if (unexpected && end.hidden === true) {
      return this.once({
        kind: 'background', what: `Welcome back${name === '' ? '' : ` to ${name}`}`,
        reason: 'Your phone closed the game while it was in the background, to free memory. Nothing went wrong in the game.',
        step: step.step, world: step.world, name: step.name, message: step.error, code: '', stack: step.errorStack, end: first(said, step.route),
        trail, routeStack: step.routeStack, at: step.t, build: step.build,
      });
    }
    return this.once({
      kind: 'restart',
      what: unexpected ? 'The game restarted unexpectedly' : 'Unexpectedly back at the title',
      reason: unexpected ? `The page stopped${name === '' ? '' : ` while ${name} was loading or running`}, without an error the game could catch. On a phone this is most often the system closing the page to free memory.${via}`
        : end.kind === 'intentional' ? `The game sent you here by itself: ${end.reason}.${via}`
          : `The page left ${name === '' ? 'the world' : name} for the title without the game or you asking (a browser back or reload, or an unmarked navigation).${via}`,
      step: step.step, world: step.world, name: step.name, message: step.error, code: '', stack: step.errorStack, end: first(said, step.route),
      trail, routeStack: step.routeStack, at: step.t, build: step.build,
    });
  }

  /**
   * A drop shows once (Jake, 2026-11-13 ~10:05: the 14:48 Driftwood drop came back word for word, same time, after other play).
   * The device copies outlive a quiet take (another tab's copies are its own, so they stay), and a later page that died read the
   * old Playing step back; the device's `seen` mark names the last drop shown, and the same drop (its world and time) never shows again.
   */
  private once(drop: Drop): Drop | null {
    let seen: Json = null;
    try { seen = this.store.read('seen'); } catch { /* storage blocked: show it */ }
    if (drop.at === 0) return drop; // no time to know it by
    if (time(seen, 'at') === drop.at && text(seen, 'world') === drop.world) return null;
    try { this.store.write('seen', { at: drop.at, world: drop.world }); } catch { /* storage blocked */ }
    return drop;
  }

  private step(device: boolean): DropStep | null {
    const raw = this.fresh('step', 'stepOnce', device);
    if (raw === null || text(raw, 'step') === '') return null;
    return { world: text(raw, 'world'), name: text(raw, 'name'), step: text(raw, 'step'), t: time(raw, 't'), build: text(raw, 'build'),
      error: text(raw, 'error'), errorStack: text(raw, 'errorStack'), route: text(raw, 'route'), routeStack: text(raw, 'routeStack'), trail: texts(raw, 'trail') };
  }
  /** the tab's session copy, else (`useDevice`: a page that died, whose sessionStorage may have gone with it) the device copy */
  private fresh(session: DropKey, device: DropKey, useDevice: boolean): Json {
    let value: Json = null;
    try { value = this.store.read(session); } catch { /* storage blocked */ }
    if (value !== null && typeof value === 'object') return value;
    if (!useDevice) return null;
    try { value = this.store.read(device); } catch { return null; }
    return value !== null && typeof value === 'object' ? value : null;
  }
  private write(session: DropKey, device: DropKey, value: Json): void {
    try { this.store.write(session, value); } catch { /* storage full or blocked */ }
    try { this.store.write(device, value); } catch { /* storage full or blocked */ }
  }
}

/** literal jsonSlot calls: test/saves-lock.test.ts reads each key from its call */
const SLOT: Readonly<Record<DropKey, () => ReturnType<typeof jsonSlot>>> = {
  step: () => jsonSlot('drop.step', 'session'), stepOnce: () => jsonSlot('drop.step.once', 'device'),
  pending: () => jsonSlot('drop.pending', 'session'), pendingOnce: () => jsonSlot('drop.pending.once', 'device'),
  expect: () => jsonSlot('drop.expect', 'session'), seen: () => jsonSlot('drop.seen', 'device'),
};
const slotOf = (key: DropKey): ReturnType<typeof jsonSlot> => SLOT[key]();
const PAGE_STORE: DropStore = {
  read: (key) => slotOf(key).peek(),
  write: (key, value) => { if (!slotOf(key).write(value)) throw new Error(`drop note ${key} not saved`); },
  clear: (key) => { slotOf(key).reset(); },
};

const page = new DropNotes(PAGE_STORE);
let listening = false;
/** Note the page's errors and its GPU loss on the breadcrumb. Idempotent. */
export function installDropNotes(scope: Scope = pageScope): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  scope.listen(window, 'error', (e) => { page.noteError(e.error ?? e.message); });
  scope.listen(window, 'unhandledrejection', (e) => { page.noteError(e.reason); });
  // a lost WebGL context fires on its canvas and does not bubble: the document's capture phase still sees it
  scope.listen(document, 'webglcontextlost', () => { page.noteError(new Error('WebGL context lost')); }, { capture: true });
}
export function markDropStep(at: { world?: string; name?: string; step: string; arrivedBy?: string }): void { page.markStep(at); }
export function noteDropError(error: unknown): void { page.noteError(error); }
/** lastEnd's markUnload: the words and the call site of every navigation the game makes */
export function noteDropRoute(reason: string): void { try { page.noteRoute(reason, new Error('route').stack ?? ''); } catch { /* the navigation goes ahead */ } }
export function recordDrop(input: DropInput): Drop { return page.record(input); }
export function leftByPlayer(why?: string): void { try { page.leftByPlayer(why); } catch { /* the navigation goes ahead */ } }
export function takeDrop(end: LastEnd): Drop | null { return page.take(end); }

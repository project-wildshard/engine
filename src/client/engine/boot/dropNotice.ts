import { pageScope } from '../../../shared/engine/app/resources';
import type { Scope } from '../../../shared/engine/app/scope';
import { jsonSlot, type Json } from '../saves/slots';
import type { LastEnd } from './lastEnd';
/**
 * The drop notice (Jake, 2026-11-12: "if the game like crashes or refreshes or like snaps the main menu, unless the user hits the
 * button … there should be some kind of modal"). Every return to the title, or page reload, that the player did not ask for shows
 * a modal on the title that says what happened (src/client/app/dropModal.ts). The only exception is the player's own exit.
 *
 *   markDropStep({ world, name, step })   a world page says where it stands, BEFORE each risky step (sessionStorage, and a
 *                                        device copy a killed iOS process can't lose): the breadcrumb
 *   noteDropError(error)                 the last error this page saw rides the breadcrumb (a crash right after it names it)
 *   recordDrop({ what, reason, error })  code that sends the page to the title by itself says why, first
 *   leftByPlayer()                       the player pressed exit / main menu: the next title shows nothing
 *   takeDrop(lastEnd())                  the title, once: the drop to show, or null (a fresh launch, a player's own exit)
 *
 * The breadcrumb dies with the tab (sessionStorage). Its device copy is read only when lastEnd says the page died (a killed
 * iOS process can lose sessionStorage too), so a cold launch, another tab or a page the player left never shows it.
 */

declare const __BUILD_ID__: string;

/** what a world page last reached */
export interface DropStep { readonly world: string; readonly name: string; readonly step: string; readonly t: number; readonly build: string;
  /** the last error this page saw before it ended, '' none */
  readonly error: string; readonly errorStack: string }
/** one drop, as the title shows it */
export interface Drop {
  /** 'error': code chose to leave and said why; 'restart': the page ended or reloaded with no word from the game */
  readonly kind: 'error' | 'restart';
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
  readonly at: number;
  readonly build: string;
}
export interface DropInput {
  readonly what?: string;
  readonly reason: string;
  readonly error?: unknown;
  readonly code?: string | number;
}
/** the store a DropNotes reads and writes: real save slots on a page, a Map in a test */
export interface DropStore {
  read: (key: DropKey) => Json;
  write: (key: DropKey, value: Json) => void;
  clear: (key: DropKey) => void;
}
type DropKey = 'step' | 'stepOnce' | 'pending' | 'pendingOnce';

/** the step a world page names once it is playing */
export const PLAYING = 'Playing';
/**
 * lastEnd reasons that are the player's own choice (the call sites' markUnload / markReload words). A title reached that way
 * is no surprise. Everything else that lands on the title with a breadcrumb is a drop.
 */
export const PLAYER_EXITS: readonly string[] = ['exit to main menu', 'exit to title', 'error modal:', 'update at title', 'update tapped',
  'new game', 'save import', 'debug:', 'tier pick', 'doctor', 'load failure reload', 'pause settings', 'settings', 'reload prompt', 'loading wait retry'];

/** two worlds that may be the same: an unknown ('') matches either */
const sameWorld = (a: string, b: string): boolean => a === '' || b === '' || a === b;
/** the first non-empty text */
const first = (...texts: readonly (string | undefined)[]): string => texts.find((t) => t !== undefined && t !== '') ?? '';
const build = (): string => { try { return __BUILD_ID__; } catch { return ''; } };
const text = (o: Json, k: string): string => { const v = typeof o === 'object' && o !== null && !Array.isArray(o) ? o[k] : undefined; return typeof v === 'string' ? v : ''; };
const time = (o: Json, k: string): number => { const v = typeof o === 'object' && o !== null && !Array.isArray(o) ? o[k] : undefined; return typeof v === 'number' && Number.isFinite(v) ? v : 0; };

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
  constructor(store: DropStore, now: () => number = Date.now) { this.store = store; this.now = now; }

  /** where the world stands now, written before the step runs */
  markStep(at: { world?: string; name?: string; step: string }): void {
    // naming the world starts a new page: nothing of the page before it carries over
    const prior = at.world === undefined ? this.step(false) : null;
    if (at.world === undefined && prior?.step === at.step) return;
    const step: DropStep = { world: at.world ?? prior?.world ?? '', name: at.name ?? prior?.name ?? '', step: at.step, t: this.now(), build: build(),
      error: prior?.error ?? '', errorStack: prior?.errorStack ?? '' };
    this.write('step', 'stepOnce', { ...step });
    // the world is up: an older recorded drop is history, not this page's
    if (at.step === PLAYING) { this.store.clear('pending'); this.store.clear('pendingOnce'); }
  }

  /** the last error this page saw: it names the cause if the page dies next */
  noteError(error: unknown): void {
    const prior = this.step(false);
    if (prior === null) return;
    const d = describeDropError(error), said = `${d.message}${d.code === '' ? '' : ` (code ${d.code})`}`.slice(0, 300);
    if (said === prior.error) return; // an error repeating every frame writes once
    this.write('step', 'stepOnce', { ...prior, error: said, errorStack: d.stack.slice(0, 2000) });
  }

  /** the game leaves for the title by itself: say why, first */
  record(input: DropInput): Drop {
    const step = this.step(false), d = describeDropError(input.error), name = first(step?.name, step?.world);
    const drop: Drop = {
      kind: 'error', what: input.what ?? (name === '' ? 'Back at the title' : `Couldn't enter ${name}`), reason: input.reason,
      step: step?.step ?? '', world: step?.world ?? '', name, message: first(d.message, step?.error),
      code: input.code === undefined ? d.code : String(input.code), stack: first(d.stack, step?.errorStack), end: '', at: this.now(), build: build(),
    };
    this.write('pending', 'pendingOnce', { ...drop });
    return drop;
  }

  /** the player chose to leave: nothing to explain on the next title */
  leftByPlayer(): void { for (const key of ['step', 'stepOnce', 'pending', 'pendingOnce'] as const) this.store.clear(key); }

  /** what the title shows, once: a recorded drop, else a restart the breadcrumb proves, else null */
  take(end: LastEnd): Drop | null {
    // the device copies are every tab's: read them only for a page that died (lastEnd's alive beat proves it), and only
    // the copy of the world that page had; a living tab's copies are its own
    const unexpected = end.kind === 'unexpected';
    const pending = this.fresh('pending', 'pendingOnce', unexpected), stepRead = this.step(unexpected);
    const step = stepRead !== null && unexpected && !sameWorld(stepRead.world, end.slug) ? null : stepRead;
    for (const key of ['step', 'pending'] as const) this.store.clear(key);
    if (unexpected) for (const key of ['stepOnce', 'pendingOnce'] as const) this.store.clear(key);
    const said = end.kind === 'fresh' ? '' : end.reason;
    if (pending !== null) {
      return { kind: 'error', what: text(pending, 'what'), reason: text(pending, 'reason'), step: text(pending, 'step'), world: text(pending, 'world'),
        name: text(pending, 'name'), message: text(pending, 'message'), code: text(pending, 'code'), stack: text(pending, 'stack'), end: said,
        at: time(pending, 'at'), build: text(pending, 'build') };
    }
    // a page that ended normally with no word from the game (Back, a typed address, another site) is the player's
    if (step === null || end.kind === 'fresh') return null;
    if (end.kind === 'intentional' && PLAYER_EXITS.some((exit) => end.reason.startsWith(exit))) return null;
    return {
      kind: 'restart', what: unexpected ? 'The game restarted unexpectedly' : 'Unexpectedly back at the title',
      reason: unexpected ? `The page stopped${step.name === '' ? '' : ` while ${step.name} was loading or running`}, without an error the game could catch. On a phone this is most often the system closing the page to free memory.`
        : end.kind === 'intentional' ? `The game reloaded by itself: ${end.reason}.` : 'The page reloaded without saying why.',
      step: step.step, world: step.world, name: step.name, message: step.error, code: '', stack: step.errorStack, end: said, at: step.t, build: step.build,
    };
  }

  private step(device: boolean): DropStep | null {
    const raw = this.fresh('step', 'stepOnce', device);
    if (raw === null || text(raw, 'step') === '') return null;
    return { world: text(raw, 'world'), name: text(raw, 'name'), step: text(raw, 'step'), t: time(raw, 't'), build: text(raw, 'build'),
      error: text(raw, 'error'), errorStack: text(raw, 'errorStack') };
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
export function markDropStep(at: { world?: string; name?: string; step: string }): void { page.markStep(at); }
export function noteDropError(error: unknown): void { page.noteError(error); }
export function recordDrop(input: DropInput): Drop { return page.record(input); }
export function leftByPlayer(): void { page.leftByPlayer(); }
export function takeDrop(end: LastEnd): Drop | null { return page.take(end); }

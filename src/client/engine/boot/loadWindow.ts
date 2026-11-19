/**
 * EM23 (meta ENGINE-MEMORY M4, design rule 3 "stream, never materialize"): the boot pipeline's one in-flight byte window.
 *
 * A part's bytes are charged from the moment its read is admitted until its consumer takes them (and, for a consumer that
 * says so, until it has decoded and uploaded them). Before this, a preparation phase read every file six at a time and held
 * each settled read until its ordered decoder reached it, so on a fast cache read the whole phase's compressed bytes stood in
 * memory at once, on top of the decode garbage. The phone tier holds them to one window (64 MB to start); desktop keeps the
 * window open and only counts.
 *
 * Two rules keep it deadlock free and keep bursts apart:
 * - **Progress:** a pipeline with nothing of its own in flight is always admitted, even past the window, so a consumer that
 *   waits on a second pipeline never waits on itself. The window can therefore be passed by at most one part per pipeline.
 * - **No burst beside a compile:** while a boot shader compile runs (`compiling`), the window admits only those progress
 *   reads, one part per pipeline, so a decode burst never stacks on a compile.
 *
 * The window's own ledger (`loadWindowStats`) is the in-flight kind: bytes now, the peak since the last reset, waits and
 * parts admitted past the window. It is not in `memoryAttribution`'s totals because the same bytes are already there as
 * array buffers. A measurement reads it as `__wsLoadWindow()`.
 */
import { TIER } from '../core/tier';
import { jsonSlot } from '../saves/slots';

/** The phone tier's starting window (EM23). */
export const PHONE_LOAD_WINDOW_BYTES: number = 64 * 1024 * 1024;

/** `charge` sets the part's bytes once they are known (a read admitted before its size was); `release` returns them. */
export interface LoadLease { readonly bytes: number; readonly charge: (bytes: number) => void; readonly release: () => void }
export interface LoadWindowStats {
  readonly window: number; readonly bytes: number; readonly peak: number; readonly admitted: number;
  readonly waited: number; readonly past: number; readonly compiling: boolean;
}
interface Waiter { readonly bytes: number; readonly alone: () => boolean; readonly grant: () => void }

export class LoadWindow {
  private inFlight = 0;
  private high = 0;
  private admittedParts = 0;
  private waitedParts = 0;
  private pastParts = 0;
  private compiles = 0;
  /** the largest part charged so far: the reservation for a part admitted before its size is known */
  private largest = 0;
  /** leases admitted with an unknown size, not charged yet */
  private unsized = 0;
  private readonly waiting: Waiter[] = [];
  private readonly budget: () => number;
  constructor(budget: () => number) { this.budget = budget; }

  /** Admit `bytes`, at once when it fits, else when earlier parts are released. `alone` says the caller has nothing of its
   *  own in flight: such a part is admitted even past the window (progress). FIFO among parts that wait. */
  admit(bytes: number, alone: () => boolean = () => false): Promise<LoadLease> {
    const now = this.tryAdmit(bytes, alone);
    if (now !== null) return Promise.resolve(now);
    this.waitedParts++;
    return new Promise<LoadLease>(resolve => { this.waiting.push({ bytes, alone, grant: () => { resolve(this.lease(bytes)); } }); });
  }
  /** `admit` without waiting: the lease when the part may start now, else null (the caller then `admit`s). A part that
   *  fits starts in the same task, so a pipeline that never waits keeps its synchronous start. */
  tryAdmit(bytes: number, alone: () => boolean = () => false): LoadLease | null {
    if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError('Invalid load window bytes');
    // a pipeline with nothing in flight never queues: what it would wait behind may be waiting on it
    return alone() || (this.waiting.length === 0 && this.fits(bytes, alone)) ? this.lease(bytes) : null;
  }
  /** A boot shader or wasm compile: until the returned function runs, only progress reads are admitted. */
  compiling(): () => void {
    this.compiles++;
    let ended = false;
    return () => { if (ended) return; ended = true; this.compiles--; this.pump(); };
  }
  stats(): LoadWindowStats {
    return { window: this.budget(), bytes: this.inFlight, peak: this.high, admitted: this.admittedParts, waited: this.waitedParts,
      past: this.pastParts, compiling: this.compiles > 0 };
  }
  /** Start a new peak, e.g. at a boot checkpoint. */
  resetPeak(): void { this.high = this.inFlight; }

  private fits(bytes: number, alone: () => boolean): boolean {
    if (alone()) return true;
    const window = this.compiles > 0 ? 0 : this.budget();
    if (window === Number.POSITIVE_INFINITY) return true; // desktop: counting only, never a wait
    if (bytes > 0) return this.inFlight + bytes <= window;
    // A part of unknown size reserves the largest part seen so far until its bytes arrive (`charge`); before any part
    // has a size, unknown parts go one at a time.
    return this.largest === 0 ? this.unsized === 0 && this.inFlight < window : this.inFlight + this.largest <= window;
  }
  private lease(initial: number): LoadLease {
    this.admittedParts++;
    let held = 0, released = false, past = false, sized = initial > 0;
    if (!sized) this.unsized++;
    const settleSize = (): void => { if (!sized) { sized = true; this.unsized--; } };
    const charge = (bytes: number): void => {
      if (released) return;
      if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError('Invalid load window bytes');
      this.inFlight += bytes - held; held = bytes;
      if (bytes > this.largest) this.largest = bytes;
      if (!past && this.inFlight > this.budget()) { past = true; this.pastParts++; }
      if (this.inFlight > this.high) this.high = this.inFlight;
      this.pump();
    };
    const reserve = initial > 0 ? initial : this.largest;
    this.inFlight += reserve; held = reserve;
    if (this.inFlight > this.budget()) { past = true; this.pastParts++; }
    if (this.inFlight > this.high) this.high = this.inFlight;
    return { get bytes() { return held; }, charge: (bytes: number): void => { settleSize(); charge(bytes); }, release: () => {
      if (released) return;
      settleSize(); this.inFlight -= held; held = 0; released = true; this.pump();
    } };
  }
  private pump(): void {
    // FIFO: the head waits for room; a later part that may pass (progress) does not queue behind it.
    for (let index = 0; index < this.waiting.length;) {
      const waiter = this.waiting[index];
      if (waiter === undefined) break;
      if (this.fits(waiter.bytes, waiter.alone) && (index === 0 || waiter.alone())) {
        this.waiting.splice(index, 1); waiter.grant(); continue;
      }
      index++;
    }
  }
}

/** The page's one window: 64 MB on the phone tier, open (counting only) elsewhere. */
export const loadWindow: LoadWindow = new LoadWindow(() => (TIER === 'phone' ? PHONE_LOAD_WINDOW_BYTES : Number.POSITIVE_INFINITY));
export function loadWindowStats(): LoadWindowStats { return loadWindow.stats(); }
if (typeof globalThis !== 'undefined') (globalThis as { __wsLoadWindow?: () => LoadWindowStats }).__wsLoadWindow = loadWindowStats;

/**
 * meta IPHONE13-REAL-TEST IP30: the phone's one decode and upload byte budget. On, the phone tier (Low by default) keeps
 * collision and the drawable spawn cover as before, and the work that piled onto the loading peak waits its turn:
 * optional audio decodes after control, and each upload batch frees its staging arrays and its garbage (WebKit's collection
 * hint, `budgetCollection`) before the next decodes. The device slot `debug.phoneBudget` (true or false) picks it; a
 * harness sets it before the boot.
 */
let budgetOn: boolean | undefined;
export function phoneBudget(): boolean {
  if (TIER !== 'phone') return false;
  // read once: each slot read parses the device save document, and the budget's own garbage must not grow with its calls
  try { budgetOn ??= jsonSlot('debug.phoneBudget', 'device').read() === true; } catch { return false; }
  return budgetOn;
}

// MMO-OBSERVABILITY OB6 (meta docs/plans/MMO-OBSERVABILITY-PLAN.md; Jake, 2026-11-24: "iphone is shit / client is shit / Nodejs MMO
// server is shit / VPS box is shit"): the page's own window on its frames and its link, taken every 10 s as one `stats` word for a door
// that reads it (`statsWord.ts`). Frames are the browser's animation frames, so a long one is a hitch the player saw, whatever caused
// it; round trips are the transport's own pings. Cheap by design: one timestamp per frame and one read per second, no allocation per frame.
import { Scope } from '../../../shared/engine/app/scope';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { LONG_FRAME_MS, type StatsWord } from '../../../shared/engine/net/statsWord';
import { ownedArray, ownedCopy } from '../../../shared/engine/core/ownedBuffer';

const SCRATCH = { owner: 'engine/linkStats', asset: 'window', kind: 'scratch' } as const;

/** At 120 Hz, a 10 s window; past it the percentiles read the first frames, while the count, the longest and the long ones see all. */
const FRAME_SLOTS = 1200;
const RTT_EVERY_MS = 1000, RTT_SLOTS = 120;

/** What a window is read from. The defaults are the page's; a test passes its own. */
export interface LinkStatsOptions {
  /** The round trip the link last measured, in ms (0: none yet). */
  readonly rtt: () => number;
  readonly now?: () => number;
  /** Whether the page is out of view (no frames are drawn then). */
  readonly hidden?: () => boolean;
  /** Whether to run the frame and round-trip loops (a test drives `frame` and `sampleRtt` itself). */
  readonly loops?: boolean;
  /** Every `everyMs`, the window's word to send: false when no door would hear it, so its lost links carry into the next. */
  readonly send?: (word: StatsWord) => boolean;
  readonly everyMs?: number;
}

const percentile = (sorted: Float32Array, at: number): number => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(at * sorted.length))] ?? 0;
const round = (ms: number): number => Math.round(ms * 10) / 10;

export class LinkStats {
  private readonly scope = new Scope('net.link-stats');
  private readonly now: () => number;
  private readonly hidden: () => boolean;
  private readonly options: LinkStatsOptions;
  private readonly frames = ownedArray(Float32Array, FRAME_SLOTS, SCRATCH);
  private readonly rtts = ownedArray(Float32Array, RTT_SLOTS, SCRATCH);
  private count = 0; private kept = 0; private longest = 0; private long = 0; private lastFrame: number | null = null;
  private rttCount = 0; private lastRtt = 0; private jitterSum = 0; private jitterCount = 0;
  private hiddenMs = 0; private hiddenAt: number | null = null; private windowAt: number;
  private lost = new Map<string, number>();
  constructor(options: LinkStatsOptions) {
    this.options = options;
    this.now = options.now ?? diagnosticNow;
    this.hidden = options.hidden ?? ((): boolean => typeof document !== 'undefined' && document.hidden);
    this.windowAt = this.now();
    if (this.hidden()) this.hiddenAt = this.windowAt;
    if (options.loops === false) return;
    // a page has animation frames; a Node harness (a bot, a test) has none, and sends no frames
    if (typeof requestAnimationFrame === 'function') { const step = (at: number): void => { this.frame(at); this.scope.raf(step); }; this.scope.raf(step); }
    this.scope.interval(RTT_EVERY_MS, () => { this.sampleRtt(); });
    if (typeof document !== 'undefined') this.scope.listen(document, 'visibilitychange', () => { this.visibility(); });
    const { send, everyMs } = options;
    if (send !== undefined && everyMs !== undefined) this.scope.interval(everyMs, () => { const word = this.take(); if (!send(word)) this.keep(word); });
  }
  /** One drawn frame at `at` (ms). The first frame after the page comes back into view starts a new interval. */
  frame(at: number): void {
    if (this.hiddenAt !== null) return;
    const last = this.lastFrame;
    this.lastFrame = at;
    if (last === null) return;
    const ms = at - last;
    if (!(ms > 0)) return;
    this.count++;
    if (this.kept < FRAME_SLOTS) this.frames[this.kept++] = ms;
    if (ms > this.longest) this.longest = ms;
    if (ms > LONG_FRAME_MS) this.long++;
  }
  /** Read the link's round trip; a new value adds to the jitter. */
  sampleRtt(): void {
    const rtt = this.options.rtt();
    if (!(rtt > 0) || rtt === this.lastRtt) return;
    if (this.lastRtt > 0) { this.jitterSum += Math.abs(rtt - this.lastRtt); this.jitterCount++; }
    this.lastRtt = rtt;
    if (this.rttCount < RTT_SLOTS) this.rtts[this.rttCount++] = rtt;
  }
  /** The page went out of view or came back. */
  visibility(): void {
    const now = this.now();
    if (this.hidden()) { this.hiddenAt ??= now; this.lastFrame = null; }
    else if (this.hiddenAt !== null) { this.hiddenMs += now - this.hiddenAt; this.hiddenAt = null; }
  }
  /** The link went down, and the redial's reason. */
  lostLink(reason: string): void { const key = /^[a-z][a-z-]{0,23}$/u.test(reason) ? reason : 'other'; this.lost.set(key, (this.lost.get(key) ?? 0) + 1); }
  /** A word that never left (no door to hear it): its lost links count in the next one. */
  keep(word: StatsWord): void { for (const [reason, n] of Object.entries(word.re ?? {})) this.lost.set(reason, (this.lost.get(reason) ?? 0) + n); }
  /** This window as a word, and a new window. */
  take(): StatsWord {
    const now = this.now();
    if (this.hiddenAt !== null) { this.hiddenMs += now - this.hiddenAt; this.hiddenAt = now; }
    const s = Math.min(120, (now - this.windowAt) / 1000), hidden = Math.min(s, this.hiddenMs / 1000);
    const frames = ownedCopy(this.frames.subarray(0, this.kept), SCRATCH).sort(), rtts = ownedCopy(this.rtts.subarray(0, this.rttCount), SCRATCH).sort();
    const re = this.lost.size === 0 ? undefined : Object.fromEntries([...this.lost].slice(0, 8));
    const word: StatsWord = { s: round(s), hidden: round(hidden), frames: this.count, p50: round(percentile(frames, 0.5)), p95: round(percentile(frames, 0.95)),
      max: round(this.longest), long: this.long,
      ...(rtts.length === 0 ? {} : { rtt50: round(percentile(rtts, 0.5)), rtt95: round(percentile(rtts, 0.95)) }),
      ...(this.jitterCount === 0 ? {} : { jitter: round(this.jitterSum / this.jitterCount) }), ...(re === undefined ? {} : { re }) };
    this.windowAt = now; this.hiddenMs = 0; this.count = 0; this.kept = 0; this.longest = 0; this.long = 0;
    this.rttCount = 0; this.jitterSum = 0; this.jitterCount = 0; this.lost = new Map();
    return word;
  }
  dispose(): void { this.scope.dispose(); }
}

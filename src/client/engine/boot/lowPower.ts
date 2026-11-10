/**
 * Low Power Mode, as far as a page can tell (Jake, 2026-11-10: "if you can detect between low power mode and non-low power
 * mode and just put it in your own diagnostics, it's fucking GG"). Safari exposes no Low Power API, but it caps
 * requestAnimationFrame at 30 Hz in Low Power Mode: the worker memory page read 30.0 frames/s with it on and 59.8 off.
 *
 * A busy page also misses frames, and a 60 Hz page that misses every other one ticks at exactly 30 Hz too, so only an
 * idle page may say "likely". The title is that page: once it has shown for two seconds it counts a second of rAF and
 * keeps the reading for the tab (the session save `boot.lowPower`), and a loading page shows it for ten minutes. A
 * loading page also counts its own first visible second, but a busy boot proves only the negative: short intervals mean
 * the display runs faster than 30 Hz ("no"); long ones say nothing ("unknown"). A window the page spent hidden, or with a
 * gap of half a second, is discarded and counted again. Diagnostics only: nothing changes behaviour.
 */
import { saveStorage } from '../saves/slots';

export interface LowPowerReading {
  /** 'likely': rAF capped near 30 Hz on an idle page; 'no': the display ran faster; 'unknown': a busy page's slow cadence. */
  readonly verdict: 'likely' | 'no' | 'unknown';
  /** rAF callbacks per second over the window. */
  readonly rate: number;
  /** The page it was read on: the idle title, or this document's own boot. */
  readonly from: 'title' | 'page';
}

const WINDOW_MS = 1000, MIN_INTERVALS = 10, LIKELY_MS = 25, GAP_MS = 500, TITLE_DELAY_MS = 2000, TITLE_FRESH_MS = 10 * 60_000;
const KEY = 'boot.lowPower';
const stored = saveStorage('session');

/** The cadence of rAF timestamps (ms, increasing): slow when even the 25th-percentile interval is 25 ms or more; null
 *  with too few frames, or with a gap (a hidden page, one long task) that makes the window no reading. */
export function classifyFrames(stamps: readonly number[]): { readonly slow: boolean; readonly rate: number } | null {
  const intervals: number[] = [];
  for (let i = 1; i < stamps.length; i++) {
    const a = stamps[i - 1], b = stamps[i];
    if (a !== undefined && b !== undefined && b > a) intervals.push(b - a);
  }
  const first = stamps[0], last = stamps.at(-1);
  if (intervals.length < MIN_INTERVALS || first === undefined || last === undefined || last <= first || intervals.some(gap => gap >= GAP_MS)) return null;
  const sorted = [...intervals].sort((x, y) => x - y), quarter = sorted[Math.floor((sorted.length - 1) / 4)] ?? 0;
  return { slow: quarter >= LIKELY_MS, rate: Math.round(intervals.length / (last - first) * 10_000) / 10 };
}

type Raf = (frame: (now: number) => void) => unknown;
const visible = (): boolean => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/** One second of rAF while the page stays visible; a hidden or gapped window is counted again, at most `tries` times. */
function countWindow(raf: Raf, done: (verdict: { readonly slow: boolean; readonly rate: number }) => void, tries = 3): void {
  const stamps: number[] = [];
  const tick = (now: number): void => {
    if (!visible()) { if (tries > 1) countWindow(raf, done, tries - 1); return; }
    stamps.push(now);
    if (now - (stamps[0] ?? now) < WINDOW_MS) { raf(tick); return; }
    const verdict = classifyFrames(stamps);
    if (verdict !== null) done(verdict);
    else if (tries > 1) countWindow(raf, done, tries - 1);
  };
  raf(tick);
}

let own: LowPowerReading | null = null, ownStarted = false, titleStarted = false;

/** This document's own first visible second (any page, from the app entry): it can say "no", never "likely". */
export function startLowPowerProbe(raf: Raf = requestAnimationFrame): void {
  if (ownStarted) return;
  ownStarted = true;
  countWindow(raf, ({ slow, rate }) => { own = { verdict: slow ? 'unknown' : 'no', rate, from: 'page' }; });
}

/** The title, once it has shown for two seconds: an idle page's cadence, kept for the tab. */
export function startTitleLowPowerProbe(raf: Raf = requestAnimationFrame, later: (run: () => void, ms: number) => unknown = setTimeout): void {
  if (titleStarted) return;
  titleStarted = true;
  later(() => {
    countWindow(raf, ({ slow, rate }) => {
      try { stored.setItem(KEY, JSON.stringify({ likely: slow, rate, at: Date.now() })); } catch { /* storage denied: no reading */ }
    });
  }, TITLE_DELAY_MS);
}

/** This tab's title reading, while fresh. */
export function titleLowPowerReading(now: number = Date.now()): LowPowerReading | null {
  try {
    const raw = stored.getItem(KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const likely: unknown = Reflect.get(value, 'likely'), rate: unknown = Reflect.get(value, 'rate'), at: unknown = Reflect.get(value, 'at');
    if (typeof likely !== 'boolean' || typeof rate !== 'number' || typeof at !== 'number' || now - at > TITLE_FRESH_MS || now < at) return null;
    return { verdict: likely ? 'likely' : 'no', rate, from: 'title' };
  } catch { return null; }
}

/** The reading to report: a fresh title reading of this tab first, else this document's own, else none yet. */
export function lowPowerReading(now: number = Date.now()): LowPowerReading | null { return titleLowPowerReading(now) ?? own; }

/** Tests only: forget this document's probes and reading. */
export function resetLowPowerProbe(): void { own = null; ownStarted = false; titleStarted = false; }

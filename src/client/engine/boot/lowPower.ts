/**
 * Low Power Mode, as far as a page can tell (Jake, 2026-11-10: "if you can detect between low power mode and non-low power
 * mode and just put it in your own diagnostics, it's fucking GG"). Safari exposes no Low Power API, but it caps
 * requestAnimationFrame at 30 Hz in Low Power Mode: the worker memory page read 30.0 frames/s with it on and 59.8 off.
 *
 * Each document counts its own rAF callbacks for about a second from its first module (`startLowPowerProbe`). A busy main
 * thread only stretches intervals, it never shortens them, so the verdict reads the short end: Low Power is likely when
 * even the 25th-percentile interval is 25 ms or longer (40 Hz or less). A reading taken on the title (an idle page) is
 * kept for the tab and preferred over a busy boot's own, for ten minutes. Diagnostics only: nothing changes behaviour.
 */
import { saveStorage } from '../saves/slots';

export interface LowPowerReading {
  /** Low Power Mode is likely on (rAF capped near 30 Hz). */
  readonly likely: boolean;
  /** rAF callbacks per second over the window. */
  readonly rate: number;
  /** The page it was read on: the idle title, or this document's own boot. */
  readonly from: 'title' | 'page';
}

const WINDOW_MS = 1000, MIN_INTERVALS = 10, LIKELY_MS = 25, TITLE_FRESH_MS = 10 * 60_000;
const KEY = 'boot.lowPower';
const stored = saveStorage('session');

/** The verdict from rAF timestamps (ms, increasing); null with too few frames to say. */
export function classifyFrames(stamps: readonly number[]): { readonly likely: boolean; readonly rate: number } | null {
  const intervals: number[] = [];
  for (let i = 1; i < stamps.length; i++) {
    const a = stamps[i - 1], b = stamps[i];
    if (a !== undefined && b !== undefined && b > a) intervals.push(b - a);
  }
  const first = stamps[0], last = stamps.at(-1);
  if (intervals.length < MIN_INTERVALS || first === undefined || last === undefined || last <= first) return null;
  const sorted = [...intervals].sort((x, y) => x - y), quarter = sorted[Math.floor((sorted.length - 1) / 4)] ?? 0;
  return { likely: quarter >= LIKELY_MS, rate: Math.round(intervals.length / (last - first) * 10_000) / 10 };
}

let own: LowPowerReading | null = null;
let started = false;
const listeners = new Set<() => void>();

function storedTitle(now: number): LowPowerReading | null {
  try {
    const raw = stored.getItem(KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const likely: unknown = Reflect.get(value, 'likely'), rate: unknown = Reflect.get(value, 'rate'), at: unknown = Reflect.get(value, 'at');
    if (typeof likely !== 'boolean' || typeof rate !== 'number' || typeof at !== 'number' || now - at > TITLE_FRESH_MS || now < at) return null;
    return { likely, rate, from: 'title' };
  } catch { return null; }
}

/** Count rAF for about a second from now, once per document. `title`: this is an idle title page, kept for the tab. */
export function startLowPowerProbe(title: boolean, raf: (frame: (now: number) => void) => unknown = requestAnimationFrame): void {
  if (started) return;
  started = true;
  const stamps: number[] = [];
  const tick = (now: number): void => {
    stamps.push(now);
    const first = stamps[0] ?? now;
    if (now - first < WINDOW_MS) { raf(tick); return; }
    const verdict = classifyFrames(stamps);
    if (verdict === null) return;
    own = { ...verdict, from: title ? 'title' : 'page' };
    if (title) try { stored.setItem(KEY, JSON.stringify({ likely: verdict.likely, rate: verdict.rate, at: Date.now() })); } catch { /* storage denied: this page only */ }
    for (const listener of listeners) listener();
  };
  raf(tick);
}

/** The reading to show: a fresh title reading of this tab first, else this document's own, else none yet. */
export function lowPowerReading(now: number = Date.now()): LowPowerReading | null {
  if (own?.from === 'title') return own;
  return storedTitle(now) ?? own;
}

/** Hear when this document's own reading lands (the card repaints its tier line). */
export function onLowPowerReading(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Tests only: forget this document's reading and probe. */
export function resetLowPowerProbe(): void { own = null; started = false; listeners.clear(); }

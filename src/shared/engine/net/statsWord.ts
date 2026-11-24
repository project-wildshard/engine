// MMO-OBSERVABILITY OB6 (meta docs/plans/MMO-OBSERVABILITY-PLAN.md; Jake, 2026-11-24: "i can't tell whats going on: iphone is shit /
// client is shit / Nodejs MMO server is shit / VPS box is shit"): the page's own side of the link, every 10 s on its socket, so the
// box's dashboard can set the phone's frames and the network's round trip beside the server's tick. The door folds it into
// histograms by human or agent and phone or desktop; nothing in it names a player, and the door keeps no row per player.

/** The `world` word's flag that says this door reads the stats word. An older door never says it, and closes `refused` on a control
 *  prefix it does not know, so a page sends one only after hearing this. */
export const STATS_WORD_FLAG = 'stats';
/** How often a page sends its word. */
export const STATS_EVERY_MS = 10_000;
/** A frame this long is a hitch a player feels (NET-LAG's B1 ceiling). */
export const LONG_FRAME_MS = 50;
/** The most bytes a stats word may hold; a longer one is refused whole (the link goes on). */
export const STATS_WORD_MAX_BYTES = 600;

/** One window of a page's link and frames. */
export interface StatsWord {
  /** The window, in seconds, and how much of it the tab was hidden (frames stop then). */
  readonly s: number; readonly hidden: number;
  /** Frames drawn, their interval's p50, p95 and longest in ms, and how many ran past `LONG_FRAME_MS`. */
  readonly frames: number; readonly p50: number; readonly p95: number; readonly max: number; readonly long: number;
  /** The page's own round trips (its pings) in the window: p50, p95 and the mean change from one to the next (jitter), in ms. */
  readonly rtt50?: number; readonly rtt95?: number; readonly jitter?: number;
  /** Links lost in the window, by the reason the redial gave (`hidden`, `offline`, `stalled`, `lost` …). */
  readonly re?: Readonly<Record<string, number>>;
}

/** Whether the door's `world` word says it reads the stats word. Never throws. */
export function worldReadsStats(bytes: ArrayBuffer): boolean {
  try { const said: unknown = JSON.parse(new TextDecoder().decode(bytes)); return typeof said === 'object' && said !== null && STATS_WORD_FLAG in said && said[STATS_WORD_FLAG] === 1; }
  catch { return false; }
}

export function encodeStatsWord(word: StatsWord): ArrayBuffer { return new TextEncoder().encode(JSON.stringify(word)).buffer; }

const REASON = /^[a-z][a-z-]{0,23}$/u, MAX_REASONS = 8;
/** A finite number in [0, `max`], or undefined. */
const bounded = (value: unknown, max: number): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;

/** The door's read of a page's word, untrusted: wrong types, out-of-range numbers or too many bytes refuse it whole; an unknown field is
 *  dropped. Never throws. */
export function readStatsWord(bytes: ArrayBuffer): StatsWord | null {
  if (bytes.byteLength === 0 || bytes.byteLength > STATS_WORD_MAX_BYTES) return null;
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return null; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const said = raw as Record<string, unknown>;
  const s = bounded(said['s'], 120), hidden = bounded(said['hidden'], 120), frames = bounded(said['frames'], 120 * 500);
  const p50 = bounded(said['p50'], 60_000), p95 = bounded(said['p95'], 60_000), max = bounded(said['max'], 120_000), long = bounded(said['long'], 120 * 500);
  if (s === undefined || hidden === undefined || frames === undefined || p50 === undefined || p95 === undefined || max === undefined || long === undefined) return null;
  const word: { -readonly [K in keyof StatsWord]: StatsWord[K] } = { s, hidden, frames: Math.round(frames), p50, p95, max, long: Math.round(long) };
  for (const key of ['rtt50', 'rtt95', 'jitter'] as const) {
    if (said[key] === undefined) continue;
    const value = bounded(said[key], 60_000);
    if (value === undefined) return null;
    word[key] = value;
  }
  if (said['re'] !== undefined) {
    const re = said['re'];
    if (typeof re !== 'object' || re === null || Array.isArray(re)) return null;
    const rows = Object.entries(re);
    if (rows.length > MAX_REASONS) return null;
    const out: Record<string, number> = {};
    for (const [reason, count] of rows) {
      const n = bounded(count, 1000);
      if (!REASON.test(reason) || n === undefined) return null;
      out[reason] = Math.round(n);
    }
    word.re = out;
  }
  return word;
}

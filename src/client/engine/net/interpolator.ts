// P1-E5.3-F2 (E5-REPLICATION §6.1): everything but this client's own character is drawn a little in the past, between two
// frames the wire really sent. Only fresh rows are samples: a held copy of an older row would read as something stopping.
// Positions lerp, angles take the short way round, pose scalars lerp, and everything else switches at the later frame.
import { FIXED_STEP } from '../../../shared/engine/core/fixedStep';
import type { DecodedFrame } from '../../../shared/engine/net/frame';
import type { NetClass, NetColumn, NetValue } from '../../../shared/engine/net/schema';

/** Frames kept per entity (§6.1). */
export const INTERP_SAMPLES = 8;
/** Past the newest sample a row runs on along its last delta this long, then holds: 50 ms (§6.1). */
export const EXTRAPOLATE_TICKS: number = 0.05 / FIXED_STEP;

const TAU = Math.PI * 2;
/** The short way from `from` to `to`, in radians. */
const arc = (from: number, to: number): number => { const turn = (to - from) % TAU; return turn > Math.PI ? turn - TAU : turn < -Math.PI ? turn + TAU : turn; };
const BLENDED: ReadonlySet<NetColumn<never>['kind']> = new Set(['f32q', 'f32', 'angle']);

const delta = (column: NetColumn<never> | undefined, from: number, to: number): number => column?.kind === 'angle' ? arc(from, to) : to - from;

/** How one class's columns blend, resolved once. */
interface Blend {
  readonly columns: readonly NetColumn<never>[];
  /** Lerped between samples; anything else switches at the later frame. */
  readonly blended: readonly boolean[];
  /** Carried on past the newest sample: where it stands and which way it faces. A pose scalar holds. */
  readonly carried: readonly boolean[];
}
function blendOf(cls: NetClass<never>): Blend {
  const moving = new Set(cls.position);
  return { columns: cls.row, blended: cls.row.map(column => BLENDED.has(column.kind)),
    carried: cls.row.map((column, index) => moving.has(index) || column.kind === 'angle') };
}

/** One entity's samples, oldest first, flat. */
interface Track { readonly blend: Blend; readonly ticks: Float64Array; readonly values: Float64Array; count: number }

/** The interpolation buffers of every visible row. */
export class Interpolator {
  private readonly tracks = new Map<number, Track>();
  private readonly blends = new Map<NetClass<never>, Blend>();
  private readonly classOf: (handle: number) => NetClass<never> | undefined;
  private newest = -1;
  /** The handle not to buffer: this client's own character is predicted. */
  own: number | null = null;
  constructor(classOf: (handle: number) => NetClass<never> | undefined) { this.classOf = classOf; }

  /** Take one decoded frame's true samples. A late frame still counts: its samples sort in by tick (§6.1). */
  push(frame: DecodedFrame): void {
    for (const handle of frame.fresh) {
      if (handle === this.own) continue;
      const row = frame.rows.get(handle), track = row === undefined ? undefined : this.track(handle);
      if (row !== undefined && track !== undefined) add(track, frame.tick, row);
    }
    if (frame.tick < this.newest) return;
    this.newest = frame.tick;
    for (const handle of this.tracks.keys()) if (!frame.rows.has(handle)) this.tracks.delete(handle); // out of relevance, or gone
  }
  /** Forget everything: the client changed cells. */
  clear(): void { this.tracks.clear(); this.newest = -1; }
  /** Handles with a track. */
  handles(): IterableIterator<number> { return this.tracks.keys(); }
  /** The columns `sample` writes for `handle`. */
  columns(handle: number): readonly NetColumn<never>[] | null { return this.tracks.get(handle)?.blend.columns ?? null; }

  /**
   * One row at `tick`, into `out`, column by column. A blended column is its value; any other is its quantised value, which
   * the column's `value` turns back. False when nothing has been heard of it. Allocates nothing.
   */
  sample(handle: number, tick: number, out: Float64Array): boolean {
    const track = this.tracks.get(handle);
    if (track === undefined || track.count === 0) return false;
    const { ticks, values, count, blend } = track, width = blend.columns.length, { blended, carried } = blend;
    let later = 0;
    while (later < count && (ticks[later] ?? 0) <= tick) later++;
    if (later === 0 || count === 1) { for (let at = 0; at < width; at++) out[at] = values[at] ?? 0; return true; }
    if (later === count) { // past the newest: run on along the last delta for at most EXTRAPOLATE_TICKS
      const a = (count - 2) * width, b = (count - 1) * width, from = ticks[count - 2] ?? 0, to = ticks[count - 1] ?? 0, past = Math.min(tick - to, EXTRAPOLATE_TICKS) / (to - from);
      for (let at = 0; at < width; at++) {
        const older = values[a + at] ?? 0, newer = values[b + at] ?? 0;
        out[at] = carried[at] !== true ? newer : newer + delta(blend.columns[at], older, newer) * past;
      }
      return true;
    }
    const a = (later - 1) * width, b = later * width, from = ticks[later - 1] ?? 0, to = ticks[later] ?? 0, t = (tick - from) / (to - from);
    for (let at = 0; at < width; at++) {
      const older = values[a + at] ?? 0, newer = values[b + at] ?? 0;
      out[at] = blended[at] === true ? older + delta(blend.columns[at], older, newer) * t : older;
    }
    return true;
  }

  /**
   * `sample` for a body a predicted player stands on, which has to stand in the present and not 100 ms behind: past the newest
   * sample it runs on along its last delta for up to `reach` ticks, where `sample` stops at 50 ms. A row the newest frames left
   * out has stopped, and holds where it stopped.
   */
  project(handle: number, tick: number, out: Float64Array, reach: number): boolean {
    const track = this.tracks.get(handle);
    if (track === undefined || track.count === 0) return false;
    const { ticks, values, count, blend } = track, to = ticks[count - 1] ?? 0, from = ticks[count - 2] ?? 0, width = blend.columns.length;
    if (tick <= to) return this.sample(handle, tick, out);
    const past = count === 1 || this.newest > to ? 0 : Math.min(tick - to, reach) / (to - from), { carried } = blend, a = (count - 2) * width, b = (count - 1) * width;
    for (let at = 0; at < width; at++) {
      const older = values[a + at] ?? 0, newer = values[b + at] ?? 0;
      out[at] = carried[at] !== true || past === 0 ? newer : newer + delta(blend.columns[at], older, newer) * past;
    }
    return true;
  }

  /** One row at `tick` as field values, for a caller that does not run per row per frame. With `reach`, as `project` reads it. */
  fields(handle: number, tick: number, reach?: number): Readonly<Record<string, NetValue>> | null {
    const columns = this.columns(handle);
    if (columns === null) return null;
    const out = new Float64Array(columns.length), fields: Record<string, NetValue> = {};
    if (reach === undefined) this.sample(handle, tick, out); else this.project(handle, tick, out, reach);
    columns.forEach((column, index) => { fields[column.name] = BLENDED.has(column.kind) ? out[index] ?? 0 : column.value(out[index] ?? 0); });
    return fields;
  }

  private track(handle: number): Track | undefined {
    const had = this.tracks.get(handle);
    if (had !== undefined) return had;
    const cls = this.classOf(handle);
    if (cls === undefined || cls.position === null) return undefined; // a value with no place: it reads from the frame
    const blend = this.blends.get(cls) ?? blendOf(cls), track = { blend, ticks: new Float64Array(INTERP_SAMPLES), values: new Float64Array(INTERP_SAMPLES * cls.row.length), count: 0 };
    this.blends.set(cls, blend); this.tracks.set(handle, track);
    return track;
  }
}

/** Sort one sample in by tick, dropping the oldest once full. A tick already held, or older than a full buffer, changes nothing. */
function add(track: Track, tick: number, row: ArrayLike<number>): void {
  const { ticks, values, blend: { columns, blended } } = track, width = columns.length;
  let at = track.count;
  while (at > 0 && (ticks[at - 1] ?? 0) > tick) at--;
  if (at > 0 && ticks[at - 1] === tick) return;
  if (track.count === INTERP_SAMPLES) {
    if (at === 0) return;
    ticks.copyWithin(0, 1, track.count); values.copyWithin(0, width, track.count * width);
    track.count--; at--;
  }
  ticks.copyWithin(at + 1, at, track.count); values.copyWithin((at + 1) * width, at * width, track.count * width);
  ticks[at] = tick;
  for (let index = 0; index < width; index++) {
    const quantised = row[index] ?? 0, value = blended[index] === true ? columns[index]?.value(quantised) : quantised;
    values[at * width + index] = typeof value === 'number' ? value : 0;
  }
  track.count++;
}

import { Vector3 } from 'three';
import { checkDayClockState, clockDayPhase, clockHour, clockPeriod, scheduleSeconds, scheduleSegment, stepDayClock, wrapClock, type DayClockState } from '../sim/dayClock';
import type { DayClockPhase, DayClockRow, DayClockSegment } from '@wildshard/format/dayCycle';

type DayPhase = DayClockPhase;
export type TimePick = 'live' | keyof DayClockRow['fixed'];
export type LightPreset = keyof DayClockRow['presets'];
export type PhaseListener = (phase: DayPhase, prev: DayPhase) => void;
export type ScheduleSeg = DayClockSegment;
interface DayKeys<K> {
  coordinate: 'phase' | 'elevation';
  frames: readonly (readonly [number, K])[];
  blend: (out: K, a: K, b: K, t: number) => void;
}
/** A clock's spec: its row (`@wildshard/format/dayCycle` DayClockRow, content data) or a sun path, with optional look keys and curves. */
export interface DayCycleSpec<K = never> extends Omit<DayClockRow, 'sun'> {
  keys?: DayKeys<K>;
  sun: DayClockRow['sun'] | { path: (p: number, out: Vector3) => Vector3; moon: (p: number, out: Vector3) => Vector3 };
  curves?: {
    night: (p: number) => number; dusk: (p: number) => number; dawn: (p: number) => number; lamps: (p: number) => number;
  };
}
export type DayCycleClock = Pick<DayCycle, 'hour' | 'phase' | 'dayPhase' | 'night' | 'dusk' | 'dawn' | 'lamps' | 'body' | 'sunDir' | 'setTime' | 'pickTime' | 'set' | 'pin' | 'scale' | 'paused' | 'update' | 'sunElevation' | 'sunAzimuth' | 'moonElevation' | 'moonAzimuth' | 'onDawn' | 'onDay' | 'onGolden' | 'onDusk' | 'onNight' | 'onPhase' | 'dayMinutes' | 'phaseProgress' | 'hold' | 'pinned'>;

/** A normalized look clock: real minutes per day, midnight-zero start and the sun's arc in degrees. */
export interface NormalizedDay { readonly minutes: number; readonly start: number; readonly maxElevation: number; readonly azimuth: number }
/** The declared look's default 12-minute day starts at noon. */
export const DEFAULT_NORMALIZED_DAY: NormalizedDay = { minutes: 12, start: 0.5, maxElevation: 60, azimuth: 35 };

const wrap = wrapClock;
export function compassDir(azimuth: number, elevation: number, out: Vector3 = new Vector3()): Vector3 {
  const az = azimuth * Math.PI / 180, el = elevation * Math.PI / 180;
  return out.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}
export function smooth(e0: number, e1: number, x: number): number {
  if (x <= e0) return 0;
  if (x >= e1) return 1;
  const t = (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
}

/**
 * One clock mechanism. Its schedule, paths, curves and look keys belong to content.
 * Its law (advance, hour, phase) is sim/dayClock.ts's, shared with the renderer-free host: `SimHost.useDayClock` steps a
 * DayCycle on its fixed step and saves it with `snapshot` / `restore`.
 */
export class DayCycle<K = never> {
  readonly spec: DayCycleSpec<K>;
  private value: number;
  private lastPhase: DayPhase;
  private listeners: { phase: DayPhase | null; fn: PhaseListener }[] = [];
  private held: { value: number; paused: boolean } | null = null;
  /** live holds (`hold`): the Explorer stills the clock where it is while it is open */
  private holds = 0;
  private readonly direction = new Vector3();
  scale = 1;
  paused = false;
  cycle: number;
  /** The backdrop waits for key decoding when a caller jumps the clock. */
  onSet: (() => Promise<void>) | null = null;

  constructor(spec: DayCycleSpec<K>) {
    if (spec.schedule.length === 0) throw new Error('DayCycle: empty schedule');
    this.spec = spec;
    this.value = wrap(spec.start, clockPeriod(spec));
    this.cycle = scheduleSeconds(spec.schedule);
    this.lastPhase = this.dayPhase;
  }
  get phase(): number { return this.spec.units === 'phase' ? this.value : this.hour / 24; }
  set phase(p: number) { this.value = this.spec.units === 'phase' ? p : wrap(p * 24, 24); this.checkPhase(); }
  get hour(): number { return clockHour(this.spec, this.value); }
  get dayPhase(): DayPhase { return clockDayPhase(this.spec, this.value); }
  get dayMinutes(): number { return this.cycle / 60; }
  get maxElevation(): number { return 'maxElevation' in this.spec.sun ? this.spec.sun.maxElevation : 0; }
  get azimuthOffset(): number { return 'azimuthOffset' in this.spec.sun ? this.spec.sun.azimuthOffset : 0; }
  get sunElevation(): number { return this.maxElevation * Math.sin(Math.PI * (this.hour - 6) / 12); }
  get sunAzimuth(): number { return 90 + (this.hour - 6) * 15 + this.azimuthOffset; }
  get moonElevation(): number { return 18 + 0.35 * Math.max(0, -this.sunElevation); }
  get moonAzimuth(): number { return this.sunAzimuth + 180; }
  sunAt(out: Vector3): Vector3 { return 'path' in this.spec.sun ? this.spec.sun.path(this.phase, out) : compassDir(this.sunAzimuth, this.sunElevation, out); }
  moonAt(out: Vector3): Vector3 { return 'path' in this.spec.sun ? this.spec.sun.moon(this.phase, out) : compassDir(this.moonAzimuth, this.moonElevation, out); }
  get body(): 'sun' | 'moon' { return this.spec.units === 'phase' ? this.phase < (this.spec.dayFraction ?? 20 / 24) ? 'sun' : 'moon' : this.sunElevation > -2 ? 'sun' : 'moon'; }
  get sunDir(): Vector3 { return this.body === 'sun' ? this.sunAt(this.direction) : this.moonAt(this.direction); }
  get night(): number { return this.spec.curves?.night(this.phase) ?? (this.sunElevation >= 6 ? 0 : this.sunElevation <= -10 ? 1 : (6 - this.sunElevation) / 16); }
  get dusk(): number { return this.spec.curves?.dusk(this.phase) ?? this.night; }
  get dawn(): number { return this.spec.curves?.dawn(this.phase) ?? (this.dayPhase === 'dawn' ? 1 : 0); }
  get lamps(): number { return this.spec.curves?.lamps(this.phase) ?? this.night; }
  get phaseProgress(): number {
    const s = this.segAt(this.hour), h = this.hour < s.from ? this.hour + 24 : this.hour;
    return (h - s.from) / (s.to - s.from);
  }
  update(dt: number): void {
    if (this.paused || this.holds > 0) return;
    this.value = stepDayClock(this.spec, this.value, dt, this.scale, this.cycle);
    this.checkPhase();
  }
  /** The whole mutable state as plain values (SimHost's strict snapshot); listeners and `onSet` are not state. */
  snapshot(): DayClockState {
    return { value: this.value, paused: this.paused, scale: this.scale, cycle: this.cycle, held: this.held === null ? null : { ...this.held }, last: this.lastPhase };
  }
  /** Exact restore of a `snapshot`: no listener fires and `onSet` is not called. */
  restore(state: DayClockState): void {
    const s = checkDayClockState(state);
    this.value = s.value; this.paused = s.paused; this.scale = s.scale; this.cycle = s.cycle;
    this.held = s.held === null ? null : { ...s.held }; this.lastPhase = s.last;
  }
  /** A time a client names: one this clock doesn't have changes nothing. */
  pickTime(name: string): void { if (name === 'live' || Object.hasOwn(this.spec.fixed, name)) this.setTime(name as TimePick); }
  setTime(t: TimePick): void {
    this.paused = t !== 'live';
    if (t !== 'live') { this.value = this.spec.fixed[t]; this.checkPhase(); void this.onSet?.(); }
  }
  async set(to: number | DayPhase | 'noon' | 'midnight'): Promise<void> {
    const named: Record<DayPhase | 'noon' | 'midnight', number> = { dawn: 5.6, day: 10, noon: 12, golden: 17.1, dusk: 18.15, night: 22.5, midnight: 0 };
    this.value = wrap(typeof to === 'number' ? to : named[to], clockPeriod(this.spec));
    this.checkPhase();
    await this.onSet?.();
  }
  /** Still the clock where it is until the returned release (the Explorer, while open): no time moves and no preset is
   *  applied; a look that follows live state as well as the clock shows its own base state while held (`pinned`). */
  hold(): () => void {
    this.holds++; let held = true;
    return () => { if (held) { held = false; this.holds--; } };
  }
  /** A light preset pin or a hold is on: the light is the clock's own, not live play state's. */
  get pinned(): boolean { return this.held !== null || this.holds > 0; }
  pin(preset: LightPreset | null): void {
    if (preset === null) {
      if (this.held) { this.value = this.held.value; this.paused = this.held.paused; this.checkPhase(); }
      this.held = null;
      return;
    }
    this.held ??= { value: this.value, paused: this.paused };
    this.value = this.spec.presets[preset];
    if (this.spec.pauseOnPin) this.paused = true;
    this.checkPhase();
  }
  segment(at: number = this.spec.keys?.coordinate === 'elevation' ? this.sunElevation : this.phase): [readonly [number, K], readonly [number, K], number] {
    const keys = this.spec.keys;
    if (!keys || keys.frames.length < 2) throw new Error('DayCycle: keyframes missing');
    const frames = keys.frames, n = frames.length;
    if (keys.coordinate === 'elevation') {
      const first = frames[0], last = frames[n - 1];
      if (!first || !last) throw new Error('DayCycle: keyframes missing');
      const descending = first[0] > last[0];
      if (descending ? at >= first[0] : at <= first[0]) return [first, first, 0];
      if (descending ? at <= last[0] : at >= last[0]) return [last, last, 0];
      for (let k = 0; k < n - 1; k++) {
        const a = frames[k], b = frames[k + 1];
        if (a && b && (descending ? at <= a[0] && at >= b[0] : at >= a[0] && at <= b[0])) {
          const t = descending ? (a[0] - at) / (a[0] - b[0]) : (at - a[0]) / (b[0] - a[0]);
          return [a, b, t * t * (3 - 2 * t)];
        }
      }
      throw new Error('DayCycle: key lookup');
    }
    let i = n - 1;
    for (let k = 0; k < n; k++) { const e = frames[k]; if (e && e[0] <= at) i = k; }
    const a = frames[i], b = frames[(i + 1) % n];
    if (!a || !b) throw new Error('DayCycle: keyframes missing');
    const pa = a[0], pb = b[0] <= pa ? b[0] + 1 : b[0], p = at < pa ? at + 1 : at;
    return [a, b, smooth(pa, pb, p)];
  }
  key(out: K): K { const [a, b, t] = this.segment(); this.spec.keys?.blend(out, a[1], b[1], t); return out; }
  onPhase(fn: PhaseListener): () => void { return this.on(null, fn); }
  onDawn(fn: PhaseListener): () => void { return this.on('dawn', fn); }
  onDay(fn: PhaseListener): () => void { return this.on('day', fn); }
  onGolden(fn: PhaseListener): () => void { return this.on('golden', fn); }
  onDusk(fn: PhaseListener): () => void { return this.on('dusk', fn); }
  onNight(fn: PhaseListener): () => void { return this.on('night', fn); }
  private on(phase: DayPhase | null, fn: PhaseListener): () => void {
    const listener = { phase, fn }; this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }
  private checkPhase(): void {
    const phase = this.dayPhase;
    if (phase === this.lastPhase) return;
    const prev = this.lastPhase; this.lastPhase = phase;
    for (const l of this.listeners.slice()) if (l.phase === null || l.phase === phase) l.fn(phase, prev);
  }
  private segAt(hour: number): ScheduleSeg { return scheduleSegment(this.spec.schedule, hour); }
}

/** One clock recipe shared by rendered data looks and their owned native director observations. */
export function normalizedDayClock(day: NormalizedDay, dayOverride: number | null): DayCycle {
  const clock = new DayCycle({ units: 'hour', start: (dayOverride ?? day.start) * 24,
    schedule: [{ phase: 'day', from: 0, to: 24, minutes: day.minutes }], sun: { maxElevation: day.maxElevation, azimuthOffset: day.azimuth },
    fixed: { midday: 12, golden: 17, sunset: 18, night: 0 }, presets: { dawn: 6, noon: 12, dusk: 18, night: 0 } });
  clock.paused = dayOverride !== null;
  return clock;
}

/** Compare a normalized half-open day interval in the clock's canonical hour units, including pinned endpoints. */
export function inNormalizedDayRange(hour: number, from: number, to: number): boolean {
  if (!Number.isFinite(hour) || hour < 0 || hour >= 24) throw new Error('Invalid director day observation');
  // Pinning a declared fraction uses wrapClock; apply the same canonicalization to the interval's endpoints.
  return hour >= wrap(from * 24, 24) && hour < (to === 1 ? 24 : wrap(to * 24, 24));
}

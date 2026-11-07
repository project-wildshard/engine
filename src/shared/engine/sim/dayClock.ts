/**
 * The day / night clock's law as pure arithmetic and plain state, shared by the page and the renderer-free host (SF72):
 * the page's `DayCycle` (world/dayCycle.ts, every shard's sky clock) advances and reads its value through these
 * functions, and `SimHost.useDayClock` (sim.ts) steps the same `DayCycle` on its fixed step and saves it as
 * `DayClockState`, so a headless witness reaches dusk, night and dawn exactly when the page's clock would.
 *
 * - **Units:** a 'phase' clock holds the day fraction [0, 1) and advances `dt · scale / cycle` (cycle = the schedule's
 *   seconds); its hour maps the first `dayFraction` (default 20 / 24) onto 06:00–18:00 and the rest onto the night. An
 *   'hour' clock holds the hour [0, 24) and advances at its current schedule segment's rate (the segment's hours over
 *   its minutes).
 * - **Phase:** a 'phase' clock names its phase from the hour by the fixed table (`hourPhase`: dawn 04:30, day 07:00,
 *   golden 16:30, dusk 18:00, night 19:45); an 'hour' clock names it from its schedule segment.
 */

import type { DayClockPhase, DayClockSegment } from '@wildshard/format/dayCycle';

/** The parts of a clock spec its law reads (DayCycleSpec's). */
export interface DayClockLaw { units: 'phase' | 'hour'; schedule: readonly DayClockSegment[]; dayFraction?: number }
/**
 * A clock's whole mutable state as plain JSON values (DayCycle.snapshot / restore): its value in its units, the pause,
 * the speed scale, the cycle seconds (a phase clock's day length), a held value under a light-preset pin, and the phase
 * its listeners last heard (so a restored clock fires the same next transition).
 */
export interface DayClockState {
  value: number; paused: boolean; scale: number; cycle: number;
  held: { value: number; paused: boolean } | null; last: DayClockPhase;
}

/** n into [0, period). */
export const wrapClock = (n: number, period: number): number => ((n % period) + period) % period;
/** A clock's period in its own units. */
export const clockPeriod = (law: Pick<DayClockLaw, 'units'>): number => law.units === 'phase' ? 1 : 24;
/** Every named phase, in order. */
export const DAY_CLOCK_PHASES: readonly ["dawn", "day", "golden", "dusk", "night"] = ['dawn', 'day', 'golden', 'dusk', 'night'] as const satisfies readonly DayClockPhase[];

/** The fixed hour table a phase clock names its phase by. */
export function hourPhase(h: number): DayClockPhase {
  const x = wrapClock(h, 24);
  return x >= 4.5 && x < 7 ? 'dawn' : x >= 7 && x < 16.5 ? 'day' : x >= 16.5 && x < 18 ? 'golden' : x >= 18 && x < 19.75 ? 'dusk' : 'night';
}
/** The schedule's whole day in seconds (a phase clock's default cycle). */
export function scheduleSeconds(schedule: readonly DayClockSegment[]): number { return schedule.reduce((sum, seg) => sum + seg.minutes * 60, 0); }
/** The schedule segment holding `hour` (the first segment if none does). */
export function scheduleSegment(schedule: readonly DayClockSegment[], hour: number): DayClockSegment {
  for (const s of schedule) if ((hour >= s.from && hour < s.to) || (hour + 24 >= s.from && hour + 24 < s.to)) return s;
  const first = schedule[0];
  if (!first) throw new Error('DayCycle: empty schedule');
  return first;
}
/** The clock's hour [0, 24) at `value`. */
export function clockHour(law: DayClockLaw, value: number): number {
  if (law.units === 'hour') return value;
  const day = law.dayFraction ?? 20 / 24, p = value;
  return (p < day ? 6 + 12 * p / day : 18 + 12 * (p - day) / (1 - day)) % 24;
}
/** The clock's named phase at `value`. */
export function clockDayPhase(law: DayClockLaw, value: number): DayClockPhase {
  return law.units === 'hour' ? scheduleSegment(law.schedule, clockHour(law, value)).phase : hourPhase(clockHour(law, value));
}
/** One unpaused step of `dt` seconds: the clock's next value. */
export function stepDayClock(law: DayClockLaw, value: number, dt: number, scale: number, cycle: number): number {
  if (law.units === 'phase') return (value + dt * scale / cycle) % 1;
  if (dt > 0) {
    const seg = scheduleSegment(law.schedule, clockHour(law, value)), rate = (seg.to - seg.from) / Math.max(1e-3, seg.minutes * 60);
    return wrapClock(value + dt * scale * rate, 24);
  }
  return value;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
/** Refuse a saved state no clock could hold (non-finite numbers, a non-positive cycle, an unknown phase). */
export function checkDayClockState(state: DayClockState): DayClockState {
  if (!finite(state.value) || typeof state.paused !== 'boolean' || !finite(state.scale) || !finite(state.cycle) || state.cycle <= 0
    || !DAY_CLOCK_PHASES.includes(state.last) || (state.held !== null && (!finite(state.held.value) || typeof state.held.paused !== 'boolean'))) throw new RangeError('Invalid day clock state');
  return state;
}

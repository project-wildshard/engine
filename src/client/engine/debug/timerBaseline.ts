export interface TimerIds { timeouts: readonly number[]; intervals: readonly number[] }

/** Timers installed by the page shell before the engine capture started. New unknown timers remain visible. */
export class ExternalTimerBaseline {
  private readonly ids: { timeouts: Set<number>; intervals: Set<number> };
  constructor(observed: TimerIds, registered: TimerIds) {
    this.ids = { timeouts: new Set(observed.timeouts.filter((id) => !registered.timeouts.includes(id))),
      intervals: new Set(observed.intervals.filter((id) => !registered.intervals.includes(id))) };
  }
  live(observed: TimerIds): { timeouts: number; intervals: number } {
    return { timeouts: observed.timeouts.filter((id) => this.ids.timeouts.has(id)).length,
      intervals: observed.intervals.filter((id) => this.ids.intervals.has(id)).length };
  }
}

/**
 * SHARD-SOURCE SS-MS1a2/a3: how a running race's start rides an owned line. Owned lines travel as f32 and read 0 as absent, so the
 * line is the start tick within a window, plus one: exact past 2^24 ticks (a room up for days), never 0 (a start at tick 0), and a
 * race's cap (at most an hour) is far inside the window, so the page reads the elapsed ticks across a wrap.
 */
export const RACE_TICK_WINDOW: number = 2 ** 20;

/** The owned line for a run that started at `tick`. */
export function raceStartLine(tick: number): number {
  return (((tick % RACE_TICK_WINDOW) + RACE_TICK_WINDOW) % RACE_TICK_WINDOW) + 1;
}

/** Ticks from the start a line carries to `now`, across the window's wrap. */
export function raceElapsedTicks(line: number, now: number): number {
  return (((now - (line - 1)) % RACE_TICK_WINDOW) + RACE_TICK_WINDOW) % RACE_TICK_WINDOW;
}

/** MIRROR-SALT-ZONE MSZ31: why a run was refused at its start, or a lap voided (MSZ33: or how it went against the rival, won or lost): the `race:<id>.chip` owned line, which
 *  `race:<id>.chipAt` stamps with the tick it showed (as `raceStartLine` writes a tick). */
export const RACE_CHIP = { vehicle: 1, foot: 2, void: 3, won: 4, lost: 5 } as const;

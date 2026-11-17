import { FIXED_STEP } from '@wildshard/engine/core/fixedStep';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import { engineString } from '@wildshard/engine/strings';
import { raceElapsedTicks } from '@wildshard/engine/game/quest/raceWire';

/** What the page shows a race in: one line of text, or nothing. */
export interface RaceClockView { show: (text: string | null) => void }
/** A declared race, as the page reads it. */
export interface RaceRow { readonly id: string }
/** How long the finish line stays up, in seconds. */
export const RACE_FINISH_SHOWN = 5;

/** `m:ss.t`: tenths, floored, so the clock never shows a time it has not reached. */
export function raceTime(seconds: number): string {
  const tenths = Math.max(0, Math.floor(seconds * 10 + 1e-6)), minutes = Math.floor(tenths / 600), rest = tenths - minutes * 600;
  return `${String(minutes)}:${String(Math.floor(rest / 10)).padStart(2, '0')}.${String(rest % 10)}`;
}

/**
 * SHARD-SOURCE SS-MS1a3: the race clock. The server's owned lines (SS-MS1a2) say when this player's run started (`race:<id>`, the tick as `raceStartLine` writes it) and,
 * once it finishes, its time and best (`.last`, `.best`, ms) and how many runs finished (`.runs`). While one runs the clock counts from its
 * start tick to the wire's latest; a finish shows the time and the best for a few seconds. A line at zero is absent.
 */
export function installRaceClock(races: readonly RaceRow[], page: {
  system: (spec: SystemSpec) => void; line: (name: string) => number; tick: () => number | null; view: RaceClockView;
}): void {
  if (races.length === 0) return;
  const seen = new Map<string, number>();
  let finish: { text: string; left: number } | null = null, shown: string | null = null;
  const show = (text: string | null): void => { if (text !== shown) { shown = text; page.view.show(text); } };
  page.system({ id: 'game.shardfile.race-clock', phase: 'update', run: (dt: number) => {
    // no wire yet (or unbound): every line reads 0, so a run count seen now would read as a finish when the wire binds
    const now = page.tick(); if (now === null) { seen.clear(); return; }
    let running: string | null = null;
    for (const race of races) {
      const runs = page.line(`race:${race.id}.runs`), before = seen.get(race.id);
      seen.set(race.id, runs);
      if (before !== undefined && runs > before) {
        finish = { text: engineString('s_race_finish', [raceTime(page.line(`race:${race.id}.last`) / 1000), raceTime(page.line(`race:${race.id}.best`) / 1000)]), left: RACE_FINISH_SHOWN };
      }
      const start = page.line(`race:${race.id}`);
      if (running === null && start > 0) running = raceTime(raceElapsedTicks(start, now) * FIXED_STEP);
    }
    if (running !== null) finish = null;
    else if (finish !== null) { finish.left -= dt; if (finish.left <= 0) finish = null; }
    show(running ?? finish?.text ?? null);
  } });
}

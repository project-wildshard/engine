import { FIXED_STEP } from '@wildshard/engine/core/fixedStep';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import { engineString } from '@wildshard/engine/strings';
import { RACE_CHIP, raceElapsedTicks } from '@wildshard/engine/game/quest/raceWire';

/** What the page shows a race in: one line of text, or nothing. */
export interface RaceClockView { show: (text: string | null) => void }
/** A declared race, as the page reads it (MSZ31: its laps, when it runs more than one). */
export interface RaceRow { readonly id: string; readonly laps?: number }
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
 * MIRROR-SALT-ZONE MSZ31: a race of laps shows the lap (`.lap`) and the last lap's time (`.split`, ms) beside the clock; a run refused
 * at its start (a race driven, or run on foot) or a void lap shows why for a few seconds (`.chip`, which `.chipAt` stamps).
 */
export function installRaceClock(races: readonly RaceRow[], page: {
  system: (spec: SystemSpec) => void; line: (name: string) => number; tick: () => number | null; view: RaceClockView;
}): void {
  if (races.length === 0) return;
  const seen = new Map<string, number>(), chips = new Map<string, number>();
  let chip: { text: string; left: number } | null = null;
  let finish: { text: string; left: number } | null = null, shown: string | null = null;
  const show = (text: string | null): void => { if (text !== shown) { shown = text; page.view.show(text); } };
  page.system({ id: 'game.shardfile.race-clock', phase: 'update', run: (dt: number) => {
    // no wire yet (or unbound): every line reads 0, so a run count seen now would read as a finish when the wire binds
    const now = page.tick(); if (now === null) { seen.clear(); chips.clear(); return; }
    let running: string | null = null;
    for (const race of races) {
      const chipAt = page.line(`race:${race.id}.chipAt`), chipBefore = chips.get(race.id); chips.set(race.id, chipAt);
      if (chipBefore !== undefined && chipAt > 0 && chipAt !== chipBefore) chip = { text: chipText(page.line(`race:${race.id}.chip`)), left: RACE_FINISH_SHOWN };
      const runs = page.line(`race:${race.id}.runs`), before = seen.get(race.id);
      seen.set(race.id, runs);
      if (before !== undefined && runs > before) {
        finish = { text: engineString('s_race_finish', [raceTime(page.line(`race:${race.id}.last`) / 1000), raceTime(page.line(`race:${race.id}.best`) / 1000)]), left: RACE_FINISH_SHOWN };
      }
      const start = page.line(`race:${race.id}`);
      if (running === null && start > 0) running = lapText(race, raceTime(raceElapsedTicks(start, now) * FIXED_STEP), page.line);
    }
    if (running !== null) finish = null;
    else if (finish !== null) { finish.left -= dt; if (finish.left <= 0) finish = null; }
    if (chip !== null) { chip.left -= dt; if (chip.left <= 0) chip = null; }
    const main = running ?? finish?.text ?? null;
    show(chip === null ? main : main === null ? chip.text : `${main} · ${chip.text}`);
  } });
}

/** MSZ31: a running race's line: the clock, and for a race of laps the lap and the last lap's time. */
function lapText(race: RaceRow, clock: string, line: (name: string) => number): string {
  const laps = race.laps ?? 1, lap = line(`race:${race.id}.lap`), split = line(`race:${race.id}.split`);
  if (laps <= 1 || lap <= 0) return clock;
  const parts = [clock, engineString('s_race_lap', [String(Math.min(lap, laps)), String(laps)])];
  if (split > 0) parts.push(engineString('s_race_split', [raceTime(split / 1000)]));
  return parts.join(' · ');
}
/** MSZ31: why a run was refused or a lap voided. */
function chipText(chip: number): string {
  return engineString(chip === RACE_CHIP.vehicle ? 's_race_vehicle_only' : chip === RACE_CHIP.foot ? 's_race_foot_only' : 's_race_lap_void');
}

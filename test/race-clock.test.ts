import { expect, test } from 'vitest';
import type { SystemSpec } from '../src/client/engine/app/systems';
import { installRaceClock, RACE_FINISH_SHOWN, raceTime } from '../src/client/game/shardfile/raceClock';
import { FIXED_STEP } from '../src/shared/engine/core/fixedStep';

// SHARD-SOURCE SS-MS1a3, the page's half: the clock runs from the wire's start tick between the flags, then shows the finish
// time and the best for a few seconds, off the lines the server's race clock (SS-MS1a2) sends this player.
function page() {
  const lines = new Map<string, number>(), systems: SystemSpec[] = [], shown: (string | null)[] = [];
  let tick: number | null = null;
  installRaceClock([{ id: 'arch' }], { system: spec => { systems.push(spec); }, line: name => lines.get(name) ?? 0, tick: () => tick,
    view: { show: text => { shown.push(text); } } });
  const frame = (dt = 1 / 60): void => { for (const system of systems) system.run(dt, 0); };
  return { lines, shown, frame, at: (next: number): void => { tick = next; } };
}

test('race time reads m:ss.t and never runs ahead', () => {
  expect(raceTime(0)).toBe('0:00.0');
  expect(raceTime(12.39)).toBe('0:12.3');
  expect(raceTime(75.05)).toBe('1:15.0');
  expect(raceTime(-1)).toBe('0:00.0');
});

test('the clock runs between the flags and shows the finish time and the best after', () => {
  const { lines, shown, frame, at } = page();
  at(100); frame();
  expect(shown).toEqual([]); // no run, nothing shown
  lines.set('race:arch', 100); at(100 + Math.round(3 / FIXED_STEP)); frame();
  expect(shown.at(-1)).toBe('0:03.0');
  at(100 + Math.round(12.5 / FIXED_STEP)); frame();
  expect(shown.at(-1)).toBe('0:12.5');
  // the finish: the start line drops and the run count, time and best arrive
  lines.delete('race:arch'); lines.set('race:arch.runs', 1); lines.set('race:arch.last', 12_600); lines.set('race:arch.best', 10_100); frame();
  expect(shown.at(-1)).toBe('0:12.6 · best 0:10.1');
  frame(RACE_FINISH_SHOWN + 0.1);
  expect(shown.at(-1)).toBeNull();
});

test('a page that joins after a finish shows no stale finish line', () => {
  const { lines, shown, frame, at } = page();
  lines.set('race:arch.runs', 3); lines.set('race:arch.last', 9000); lines.set('race:arch.best', 8000); at(5); frame();
  expect(shown).toEqual([]);
});

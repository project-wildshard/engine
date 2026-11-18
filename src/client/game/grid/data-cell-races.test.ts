// @vitest-environment node
// SHARD-SOURCE SS-MS1b: a grid data cell's race clock. On staging (v0.1.40, 2026-11-18) Mirror Salt's arch line ran on the
// cell's server (the gates rose in order and the finish filed `mirror.race`) but the page showed no clock: a one-shard page
// installs it in its shardfile client (`raceClock.ts`), a grid copy never did. While the feet stand in the copy its races
// run the clock off the cell server's lines, and it leaves with the stay.
import { afterEach, expect, test, vi } from 'vitest';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { FIXED_STEP } from '@wildshard/engine/core/fixedStep';
import { raceStartLine } from '@wildshard/engine/game/quest/raceWire';
import { wirePage } from '../shardfile/wirePage';
import { Scope } from '@wildshard/engine/app/scope';
import { PLAY_INSTALLS, hasRaces, installPlay } from '../shardfile/playInstalls';
import { cellPlayPort } from './dataCellPlay';

const race = { id: 'arch', start: 'arch.0', stop: 'arch.8', fact: 'arch', cap: 600 };
const source = { quests: { flags: [], quests: [], triggers: [], dialogue: [], races: [race] } } as unknown as Shardfile;

afterEach(() => { vi.restoreAllMocks(); });

test('a copy with races runs its clock off the cell server\'s lines for the stay', () => {
  expect(hasRaces(source)).toBe(true);
  expect(hasRaces({ quests: { ...source.quests, races: [] } })).toBe(false);
  expect(hasRaces({ quests: { flags: [], quests: [], triggers: [], dialogue: [] } })).toBe(false);
  const lines = new Map<string, number>();
  let tick: number | null = 100;
  vi.spyOn(wirePage, 'line').mockImplementation((name) => lines.get(name) ?? 0);
  vi.spyOn(wirePage, 'tick').mockImplementation(() => tick);
  const systems: SystemSpec[] = [], shown: (string | null)[] = [];
  let here = true;
  installPlay(source, cellPlayPort(new Scope('grid.data-play.fixture'), () => here, { system: (spec) => { systems.push(spec); },
    views: { raceClock: () => ({ show: (text) => { shown.push(text); } }) } }), PLAY_INSTALLS.filter(entry => entry.id === 'races'));
  const frame = (): void => { for (const system of systems) system.run(1 / 60, 0); };
  frame();
  expect(shown).toEqual([]); // no run yet
  lines.set('race:arch', raceStartLine(100)); tick = 100 + Math.round(4 / FIXED_STEP); frame();
  expect(shown.at(-1)).toBe('0:04.0');
  here = false; // mid-crossing the wire is another cell's: its lines and tick are not this race's
  tick = 100 + Math.round(9 / FIXED_STEP); frame();
  expect(shown.at(-1)).toBe('0:04.0');
  here = true; frame();
  expect(shown.at(-1)).toBe('0:09.0');
  lines.delete('race:arch'); lines.set('race:arch.runs', 1); lines.set('race:arch.last', 9100); lines.set('race:arch.best', 9100); frame();
  expect(shown.at(-1)).toBe('0:09.1 · best 0:09.1');
});

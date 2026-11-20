// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { SystemSpec } from '../src/client/engine/app/systems';
import { installRaceClock, RACE_FINISH_SHOWN } from '../src/client/game/shardfile/raceClock';
import { createSimHost } from '../src/server/engine/sim';
import { FIXED_STEP } from '../src/shared/engine/core/fixedStep';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { questBooks } from '../src/shared/engine/quest/players';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { DeclaredQuests, type RaceRide } from '../src/shared/game/quest/declared';
import { RACE_CHIP, raceStartLine } from '../src/shared/game/quest/raceWire';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// MIRROR-SALT-ZONE MSZ31: a race of laps counts a lap at its stop only once every checkpoint was crossed in order, voids a lap
// that missed one, and finishes on the last lap; a race that names how it is ridden refuses a run begun the wrong way.
const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
const loop = { flags: ['rim.line', 'rim.end', 'rim.a', 'rim.b'], quests: [], triggers: [], dialogue: [],
  races: [{ id: 'rim', start: 'rim.line', stop: 'rim.end', fact: 'rim.time', cap: 600, laps: 2, checkpoints: ['rim.a', 'rim.b'], ride: 'vehicle' as const }] };
const steps = (host: ReturnType<typeof createSimHost>, n: number): void => { for (let i = 0; i < n; i++) host.step(); };
const owned = (host: ReturnType<typeof createSimHost>, player: string): Map<string, number> => {
  const out = new Map<string, number>(); shardRows(host).owned.get('quest.races')?.(player, out); return out;
};

test('a two-lap race counts a lap over its checkpoints, voids a lap that missed one and finishes on the last', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await rapier }), filed: [string, string][] = [];
  try {
    const quests = new DeclaredQuests(host, loop, { fact: (name, entity) => { filed.push([name, entity]); }, ride: () => 'vehicle' });
    const { flags, player } = questBooks(host).lead;
    flags.set('rim.line'); const started = host.state.tick;
    expect(owned(host, player).get('race:rim.lap')).toBe(1);
    steps(host, 10); flags.set('rim.a'); steps(host, 10); flags.set('rim.b'); steps(host, 10); flags.set('rim.end');
    expect(quests.race('rim', player)).toMatchObject({ running: started, lap: 1, next: 0, split: 30 * FIXED_STEP });
    expect(owned(host, player).get('race:rim.lap')).toBe(2);
    expect(owned(host, player).get('race:rim.split')).toBe(Math.round(30 * FIXED_STEP * 1000));
    // the line's stop stays up until the lap's first checkpoint, so standing on the line counts nothing
    expect(flags.has('rim.end')).toBe(true);
    flags.set('rim.a'); expect(flags.has('rim.end')).toBe(false);
    // lap 2 misses b: the line voids it with a chip and the lap is run again
    steps(host, 10); flags.set('rim.end');
    expect(quests.race('rim', player)).toMatchObject({ running: started, lap: 1, next: 0 });
    expect(owned(host, player).get('race:rim.chip')).toBe(RACE_CHIP.void);
    expect(owned(host, player).get('race:rim.chipAt')).toBe(raceStartLine(host.state.tick));
    expect(filed).toEqual([]);
    // a checkpoint out of order does not count
    flags.set('rim.b'); expect(flags.has('rim.b')).toBe(false);
    flags.set('rim.a'); steps(host, 5); flags.set('rim.b'); steps(host, 5); flags.set('rim.end');
    expect(filed).toEqual([['rim.time', 'rim']]);
    expect(quests.race('rim', player)).toEqual({ running: null, last: 50 * FIXED_STEP, best: 50 * FIXED_STEP, runs: 1 });
    expect(['rim.line', 'rim.end', 'rim.a', 'rim.b'].some(flag => flags.has(flag))).toBe(false);
    expect(owned(host, player).has('race:rim.lap')).toBe(false);
  } finally { host.dispose(); }
});

test('a driven race refuses a run begun on the board, with a chip, and starts in a vehicle', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await rapier });
  try {
    let moving: RaceRide = 'board';
    const quests = new DeclaredQuests(host, loop, { fact: () => undefined, ride: () => moving });
    const { flags, player } = questBooks(host).lead;
    flags.set('rim.line');
    expect(quests.race('rim', player)?.running).toBeNull();
    expect(flags.has('rim.line')).toBe(false); // lowered, so it can start again
    expect(owned(host, player).get('race:rim.chip')).toBe(RACE_CHIP.vehicle);
    moving = 'foot'; flags.set('rim.line');
    expect(quests.race('rim', player)?.running).toBeNull();
    moving = 'vehicle'; flags.set('rim.line');
    expect(quests.race('rim', player)?.running).toBe(host.state.tick);
    // a race on foot refuses a vehicle
    const foot = { ...loop, flags: [...loop.flags, 'walk.go', 'walk.end'], races: [...loop.races, { id: 'walk', start: 'walk.go', stop: 'walk.end', fact: 'walk.time', cap: 60, ride: 'foot' as const }] };
    const other = createSimHost(SIM_LEVEL, { rapier: await rapier });
    try {
      const walk = new DeclaredQuests(other, foot, { fact: () => undefined, ride: () => 'vehicle' }), lead = questBooks(other).lead;
      lead.flags.set('walk.go');
      expect(walk.race('walk', lead.player)?.running).toBeNull();
      expect(owned(other, lead.player).get('race:walk.chip')).toBe(RACE_CHIP.foot);
    } finally { other.dispose(); }
  } finally { host.dispose(); }
});

test('a lapped run mid-lap rides the book\'s save', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await rapier });
  try {
    host.addPlayer('other', { x: 0, y: 0, z: 0 });
    const quests = new DeclaredQuests(host, loop, { fact: () => undefined, ride: () => 'vehicle' }), books = questBooks(host), flags = books.of('other').flags;
    flags.set('rim.line'); flags.set('rim.a'); flags.set('rim.b'); steps(host, 4); flags.set('rim.end'); flags.set('rim.a');
    const saved = books.exportOf('other'), before = quests.race('rim', 'other');
    flags.set('rim.b'); books.importOf('other', saved);
    expect(quests.race('rim', 'other')).toEqual(before);
    expect(before).toMatchObject({ lap: 1, next: 1 });
  } finally { host.dispose(); }
});

test('the page shows the lap, the last lap\'s time and a chip', () => {
  const lines = new Map<string, number>(), systems: SystemSpec[] = [], shown: (string | null)[] = [];
  let tick = 100;
  installRaceClock([{ id: 'rim', laps: 2 }], { system: spec => { systems.push(spec); }, line: name => lines.get(name) ?? 0, tick: () => tick,
    view: { show: text => { shown.push(text); } } });
  const frame = (dt = 1 / 60): void => { for (const system of systems) system.run(dt, 0); };
  frame();
  lines.set('race:rim', raceStartLine(100)); lines.set('race:rim.lap', 2); lines.set('race:rim.split', 41_200); tick = 100 + Math.round(45 / FIXED_STEP); frame();
  expect(shown.at(-1)).toBe('0:45.0 · lap 2/2 · split 0:41.2');
  lines.set('race:rim.chip', RACE_CHIP.void); lines.set('race:rim.chipAt', raceStartLine(tick)); frame();
  expect(shown.at(-1)).toBe('0:45.0 · lap 2/2 · split 0:41.2 · Lap void: missed a checkpoint');
  frame(RACE_FINISH_SHOWN + 0.1);
  expect(shown.at(-1)).toBe('0:45.0 · lap 2/2 · split 0:41.2');
  lines.clear(); lines.set('race:rim.chip', RACE_CHIP.vehicle); lines.set('race:rim.chipAt', raceStartLine(tick + 1)); frame();
  expect(shown.at(-1)).toBe('This race is driven: take a vehicle');
});

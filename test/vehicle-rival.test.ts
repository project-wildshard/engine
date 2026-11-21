// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics module and reads the example's section.
import { readFileSync } from 'node:fs';
import { parseVehicles } from '@wildshard/format/vehicles';
import { expect, test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { questBooks } from '../src/shared/engine/quest/players';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { DeclaredQuests } from '../src/shared/game/quest/declared';
import { RACE_CHIP } from '../src/shared/game/quest/raceWire';
import { VehicleRuntime } from '../src/server/game/plugin/vehicleRuntime';
import { rivalVehicle } from '../src/shared/game/shardfile/wirePrompts';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { VEHICLES_EXAMPLE } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ33: a race's rival. A run's start sends him out in his dock's vehicle, beside his line's start, and his
// AI drives the line; he wins a run the player idles through, and a player who finishes first raises the race's beat flag.
// Either way he goes home when the run ends. He takes no seat and is never saved.
const LINE: [number, number, number][] = [[14, 0, 0], [14, 0, -30], [14, 0, -60]];
const DUEL = {
  flags: ['duel.go', 'duel.end', 'duel.beat'], quests: [], triggers: [], dialogue: [],
  races: [{ id: 'duel', start: 'duel.go', stop: 'duel.end', fact: 'duel', cap: 120, ride: 'any' as const,
    rival: { name: 'Sorrel Vane', dock: 'line.sail', line: LINE, speed: 12, beat: 'duel.beat' } }],
};

async function duel(): Promise<{ host: ReturnType<typeof createSimHost>; runtime: VehicleRuntime; player: string; flags: ReturnType<typeof questBooks>['lead']['flags']; quests: DeclaredQuests; filed: string[]; steps: (n: number) => void; chip: () => number | undefined; chipAt: () => number }> {
  const vehicles = parseVehicles(JSON.parse(readFileSync(VEHICLES_EXAMPLE, 'utf8')));
  const level = { ...SIM_LEVEL, entities: [], ground: { size: 160, height: 0 }, player: { ...SIM_LEVEL.player, at: { x: -6, y: 0, z: 22 } } };
  const host = createSimHost(level, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  const runtime = new VehicleRuntime(vehicles, { physics: () => host.physics, stick: () => undefined });
  runtime.bind(host);
  const filed: string[] = [];
  const quests = new DeclaredQuests(host, DUEL, { fact: name => { filed.push(name); },
    rival: { start: (who, race) => { runtime.startRival(who, race); }, finished: (who, race) => runtime.rivalFinished(who, race), stop: (who, race) => { runtime.stopRival(who, race); } } });
  const { flags, player } = questBooks(host).lead;
  const line = (name: string): number | undefined => { const out = new Map<string, number>(); shardRows(host).owned.get('quest.races')?.(player, out); return out.get(`race:duel.${name}`); };
  return { host, runtime, player, flags, quests, filed, chip: () => line('chip'), chipAt: () => line('chipAt') ?? 0, steps: n => { for (let i = 0; i < n; i++) host.step(); } };
}

test('an idle player loses: the rival drives his line to its end, the player hears it, and a late finish raises no beat flag', async () => {
  const { host, runtime, player, flags, filed, chip, chipAt, steps } = await duel();
  try {
    flags.set('duel.go');
    const id = runtime.rivalOf(player, 'duel');
    expect(id).toBe(rivalVehicle('line.sail', 'duel', player));
    expect(runtime.prompts().some(prompt => prompt.vehicle === id)).toBe(false); // no seat of his to take
    if (id === undefined) throw new Error('No rival');
    const start = runtime.pose(id).position;
    expect(Math.hypot(start.x - 17.5, start.z)).toBeLessThan(0.5); // beside his line's start, to its right
    let tick = 0;
    while (!runtime.rivalFinished(player, 'duel') && tick < 60 * 30) { steps(1); tick++; }
    expect(runtime.rivalFinished(player, 'duel')).toBe(true);
    expect(tick / 60).toBeLessThan(20);
    expect(runtime.pose(id).position.z).toBeLessThan(-50); // at his line's end
    expect(Math.abs(runtime.pose(id).position.x - 14)).toBeLessThan(2); // on it
    steps(2);
    expect(chip()).toBe(RACE_CHIP.lost);
    flags.set('duel.end');
    expect(filed).toEqual(['duel']); // the run still finishes, for its time
    expect(flags.has('duel.beat')).toBe(false);
    expect(chip()).toBe(RACE_CHIP.lost);
    expect(runtime.rivalOf(player, 'duel')).toBeUndefined(); // home
    // the next run he wins says so again, though the last run's chip said the same
    const before = chipAt();
    flags.set('duel.go'); tick = 0;
    while (!runtime.rivalFinished(player, 'duel') && tick < 60 * 30) { steps(1); tick++; }
    steps(2);
    expect(chip()).toBe(RACE_CHIP.lost);
    expect(chipAt()).toBeGreaterThan(before);
  } finally { host.dispose(); }
});

test('a player who finishes first beats him: the beat flag rises, the chip says so, and he goes home', async () => {
  const { host, runtime, player, flags, chip, steps } = await duel();
  try {
    flags.set('duel.go'); steps(120);
    expect(runtime.rivalFinished(player, 'duel')).toBe(false);
    flags.set('duel.end');
    expect(flags.has('duel.beat')).toBe(true);
    expect(chip()).toBe(RACE_CHIP.won);
    expect(runtime.rivalOf(player, 'duel')).toBeUndefined();
    // a new run sends a fresh rival out from the start, and the won chip stays to be shown (a lap race's line is both)
    flags.set('duel.go');
    expect(chip()).toBe(RACE_CHIP.won);
    const id = runtime.rivalOf(player, 'duel'); if (id === undefined) throw new Error('No rival');
    expect(Math.hypot(runtime.pose(id).position.x - 17.5, runtime.pose(id).position.z)).toBeLessThan(0.5);
  } finally { host.dispose(); }
});

test('a run past its cap sends him home', async () => {
  const { host, runtime, player, flags, quests, steps } = await duel();
  try {
    flags.set('duel.go'); steps(60 * 121);
    expect(quests.race('duel', player)?.running).toBe(null);
    expect(runtime.rivalOf(player, 'duel')).toBeUndefined();
  } finally { host.dispose(); }
});

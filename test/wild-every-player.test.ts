// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { bindFlatTerrain } from '@wildshard/engine/test/terrain';
import { ForagerPopulationSchema } from '@wildshard/format/ambientLife';
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { beforeEach,expect,test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { ForagerPopulation } from '../src/shared/engine/ai/ambientForager';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { dataCreaturePorts } from '../src/shared/game/shardfile/dataCreaturePorts';
import marmots from './fixtures/engine-lift/foragers.json' with { type: 'json' };
import { SIM_LEVEL } from './fixtures/sim-level/level';

beforeEach(() => bindFlatTerrain({ heightAt: () => 0, waterLevel: () => -100,
  normalAt: () => [0, 1, 0], cabinMask: () => 0, pondMask: () => 0, streamAt: () => null }));

test('a forager answers to the watcher beside it, not the one the frame names', () => {
  const row = v.parse(ForagerPopulationSchema, marmots), far = { x: 900, z: 900 }, population = new ForagerPopulation(row, 41);
  if (row.place.kind === 'roam') population.roam(far); else population.colonies([{ x: 5, z: 5 }]);
  const first = population.rows[0]; if (first === undefined) throw new Error('Missing forager');
  const beside = { x: first.x, z: first.z };
  for (let i = 0; i < 300; i++) population.update(1 / 60, far, false);
  expect(population.rows.some(forager => forager.mode === 'flee' || forager.mode === 'hide')).toBe(false);
  for (let i = 0; i < 300; i++) population.update(1 / 60, far, false, false, () => ({ viewer: beside, fast: true, crouched: false }));
  expect(population.rows.some(forager => forager.mode === 'flee' || forager.mode === 'hide')).toBe(true);
});

test('a creature reads the pace of the player it deals with, and a room saves every pace', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const level = { ...SIM_LEVEL, entities: [] };
  const install = (host: ReturnType<typeof createSimHost>) => {
    const ports = dataCreaturePorts(host, { strikes: [] } as never), herd = ports.groups.herd?.({ id: 'herd.test' } as never, [], undefined as never);
    if (herd === undefined) throw new Error('Missing herd ports');
    ports.install();
    return herd;
  };
  const host = createSimHost(level, { rapier });
  try {
    const herd = install(host), lead = leadPlayer(host), bot = host.addPlayer('bot:1', { x: 40, y: 0, z: 0 });
    const near = (x: number) => ({ position: { x, y: 0, z: 0 } }) as never;
    host.step();
    const walk = 0.2, hops = 5;
    for (let tick = 0; tick < hops; tick++) { bot.position.x += walk; bot.motor.resetAt(bot.position); host.step(); }
    const speed = walk * 60;
    expect(herd.observe(near(bot.position.x), 1 / 60).playerSpeed).toBeCloseTo(speed, 3);
    expect(herd.observe(near(lead.position.x), 1 / 60).playerSpeed).toBeCloseTo(0, 3);

    let after = herd;
    const resumed = restoreSimHost(level, { rapier }, snapshotSimHost(host), fresh => { after = install(fresh); });
    try {
      expect(after.observe(near(resumed.players.get('bot:1')?.position.x ?? 0), 1 / 60).playerSpeed).toBeCloseTo(speed, 3);
    } finally { resumed.dispose(); }
  } finally { host.dispose(); }
});

test('alone, the pace saves as it always did', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier });
  try {
    const ports = dataCreaturePorts(host, { strikes: [] } as never);
    ports.groups.herd?.({ id: 'herd.test' } as never, [], undefined as never); ports.install(); host.step();
    const row = snapshotSimHost(host).adapters.find(adapter => adapter.id === 'creatures.data-motion');
    expect(Object.keys((row?.state ?? {}) as object).sort()).toEqual(['speed', 'x', 'z']);
  } finally { host.dispose(); }
});

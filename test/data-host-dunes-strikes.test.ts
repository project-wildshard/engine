// ONE-FORMAT OF11b: Dunes' ray and strider on the data host strike as they do on the program host. The program's strikes
// (sdk `speciesProgramToRows` fixture, Dunes 959969f) become plain rows; the data host's strike for each must be the
// program's own (`strikeFromData`) in every field the runner reads. The charge's distance score is the challenge
// brain's tuning on both hosts (ai/grazer.ts), so only its overshoot had no row field.
import { readFileSync } from 'node:fs';
import { bindFlatTerrain } from '@wildshard/engine/test/terrain';
import { beforeEach, expect, test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { strikeFromData, type StrikeData } from '../src/shared/engine/ai/strikeRows';
import { dataCreaturePorts } from '../src/shared/game/shardfile/dataCreaturePorts';
import { SIM_LEVEL } from './fixtures/sim-level/level';

const program: StrikeData[] = [
  { id: 'sunscar.ray.swoop', shape: { kind: 'sphere', radius: 2.2 }, windup: 0.3, active: 0.4, recover: 0.5, cooldown: 2.5, range: 7, damage: 14,
    tags: ['creature.duneRay'], units: 'world', weight: { kind: 'constant', value: 1 } },
  { id: 'sunscar.strider.charge', shape: { kind: 'lane', length: 13, width: 2.2 }, windup: 1.1, active: 1.2, recover: 1.8, cooldown: 3.5, range: 17,
    damage: 22, tags: ['creature.duneStrider'], motion: { overshoot: 3, speed: 11 }, weight: { kind: 'horizontal-distance', above: 5, far: 2, near: 0.2 } },
  { id: 'sunscar.strider.horns', shape: { kind: 'arc', radius: 3.4, halfAngle: 0.9 }, windup: 0.6, active: 0.2, recover: 0.8, cooldown: 1.6, range: 3.2,
    damage: 12, tags: ['creature.duneStrider'], weight: { kind: 'constant', value: 1 } },
] as StrikeData[];
// sdk speciesProgramToRows' plain rows for the same strikes
const rows = [
  { id: 'sunscar.ray.swoop', shape: { kind: 'sphere', radius: 2.2 }, windup: 0.3, active: 0.4, recover: 0.5, cooldown: 2.5, range: 7, damage: 14,
    tags: ['creature.duneRay'], weight: 1, speed: 0 },
  { id: 'sunscar.strider.charge', shape: { kind: 'lane', length: 13, width: 2.2 }, windup: 1.1, active: 1.2, recover: 1.8, cooldown: 3.5, range: 17,
    damage: 22, tags: ['creature.duneStrider'], weight: 1, speed: 11, overshoot: 3 },
  { id: 'sunscar.strider.horns', shape: { kind: 'arc', radius: 3.4, halfAngle: 0.9 }, windup: 0.6, active: 0.2, recover: 0.8, cooldown: 1.6, range: 3.2,
    damage: 12, tags: ['creature.duneStrider'], weight: 1, speed: 0 },
];

beforeEach(() => bindFlatTerrain({ heightAt: () => 0, waterLevel: () => -100,
  normalAt: () => [0, 1, 0], cabinMask: () => 0, pondMask: () => 0, streamAt: () => null }));

/** What the strike runner reads of a strike, weight aside. */
function ran(strike: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const { weight: _weight, units, motion, ...rest } = strike as Record<string, unknown> & { motion?: Record<string, unknown> };
  return { ...rest, units: units ?? 'world', motion: { speed: 0, ...motion } };
}

test('the data host runs Dunes ray and strider strikes as the program does', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier });
  try {
    const spawns = [{ id: 'strider', phaseOffset: 0.2 }, { id: 'ray' }] as never;
    const ports = dataCreaturePorts(host, { strikes: rows } as never, spawns);
    const actor = (id: string) => ({ entityId: id, position: { x: 0, y: 0, z: 0 } }) as never;
    const strider = ports.brains.challengeGrazer?.(actor('strider'), { charge: 'sunscar.strider.charge', close: 'sunscar.strider.horns' } as never, host) as unknown as
      { charge: Record<string, unknown>; close: Record<string, unknown> };
    const ray = ports.brains.patrolDiver?.(actor('ray'), { strike: 'sunscar.ray.swoop' } as never, host) as unknown as { strike: Record<string, unknown> };
    const [swoop, charge, horns] = program.map(strikeFromData) as unknown as Record<string, unknown>[];
    expect(ran(strider.charge)).toEqual(ran(charge ?? {}));
    expect(ran(strider.close)).toEqual(ran(horns ?? {}));
    expect(ran(ray.strike)).toEqual(ran(swoop ?? {}));
    expect(strider.charge['motion']).toEqual({ speed: 11, overshoot: 3 });
  } finally { host.dispose(); }
});

import * as v from 'valibot';
import { flatPopulationEnvironment } from './fixtures/population-environment';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real v1 guests and native body authority.
import { leadCommands,leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { parseEliteFeature } from '@wildshard/format/eliteFeature';
import { readSpeciesPrograms } from '@wildshard/format/speciesPrograms';
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { installPopulationRoster } from '../src/server/game/population/roster';
import { installNativeEliteFeature } from '../src/server/game/quest/eliteFeature';
import { Rng } from '../src/shared/engine/core/rng';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { DayCycle } from '../src/shared/engine/world/dayCycle';
import { keyedSkyDaySpec } from '../src/shared/game/looks/keyedSkyClock';
import { eliteStream } from '../src/shared/game/quest/eliteStreams';
import PINE_SKY from './fixtures/engine-lift/pine-sky.json' with { type: 'json' };
import { pineElites as data,pineSpecies as PINE_SPECIES_PROGRAMS,pinePin } from './fixtures/engine-lift/pins';
import { SIM_LEVEL } from './fixtures/sim-level/level';
const PINE_ELITE_MODULES = pinePin.assets;

async function fixture() {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const host = createSimHost({ ...SIM_LEVEL, id: 'pine-hollow', seed: 1337, ground: { size: 500, height: 0 }, entities: [] }, { rapier });
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing recipe');
  const species = new Map(data.fights.flatMap(fight => fight.program.species).map(row => [`${row.kind}.${row.variant}`, row]));
  const parked = [...species.values()].map((row, i) => ({ seed: sample.seed, scale: sample.scale, id: `recipe.${i}`, kind: row.kind, variant: row.variant,
    spec: { ...sample.spec, kind: row.kind, variant: row.variant }}));
  flatPopulationEnvironment(host);
  installPopulationRoster(host, { population: readSpeciesPrograms(PINE_SPECIES_PROGRAMS), nav: null, spawnY: 20,
    bake: { actors: [], parked, herds: [] } }, { version: 1, environment: 'fixture.habitat', step: 'pine.roster', seed: 1368, bodyCount: 0, limit: 512,
    scripted: 'sidestep', encounter: 'test', poseKinds: [], spawn: { x: 0, z: 0 }, fauna: [], identities: [], ordinary: {}, reserves: [], homes: [] });
  const day = new DayCycle(keyedSkyDaySpec(PINE_SKY)); await day.set(PINE_SKY.phases.night);
  // Reconstruct the original inline native oracle from the same named raw guests.
  const admitted = structuredClone(data);
  for (const fight of admitted.fights) {
    const hash = fight.program.script.module.slice('blobs/wasm/'.length, -'.wasm'.length);
    const bytes = PINE_ELITE_MODULES.get(hash);
    if (bytes === undefined) throw new Error(`Missing compiled elite ${hash}`);
    fight.program.bytes = Buffer.from(bytes).toString('base64');
  }
  const feature = installNativeEliteFeature(host, day, admitted); feature.initialize();
  return { host, feature };
}

test('Pine elite identities and streams are rows; all four v1 guests run without refusals', async () => {
  const { host, feature } = await fixture();
  try {
    expect(feature.scripts.map(script => [script.def.id, script.animal?.kind, script.animal?.variant])).toEqual([
      ['ironhide', 'boar', 'ironhide'], ['ghost-stag', 'deer', 'ghost'], ['blackpaw', 'bear', 'black-old'], ['imperial-bull', 'elk', 'imperial']]);
    const rows = parseEliteFeature(data);
    for (const script of feature.scripts) {
      const stream = eliteStream(rows, 1337, 'spawn', script.def.id); stream.next();
      expect(script.spawnStream.snapshot()).toEqual(stream.snapshot());
      expect(script.row.program.seed).toBe(new Rng(1337).fork(`pine.elite.${script.def.id}`).snapshot().initial);
      const body = script.animal; if (body === null) throw new Error('Missing lair body');
      leadPlayer(host).position.copy(body.position); leadPlayer(host).position.z += 8;
      feature.core.devSpawn(script.def.id);
      for (let tick = 0; tick < 140; tick++) host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0 }));
      expect(script.program.failure).toBeNull(); expect(script.program.host.metrics().every(row => row.refusals === 0)).toBe(true);
    }
  } finally { host.dispose(); }
}, 10_000);

test('a running Imperial call keeps rival identities and restores quietly and atomically', async () => {
  const { host, feature } = await fixture();
  try {
    const script = feature.scripts.find(row => row.def.id === 'imperial-bull'); if (script?.animal === null || script === undefined) throw new Error('Missing bull');
    leadPlayer(host).position.copy(script.animal.position); leadPlayer(host).position.z += 20;
    feature.core.devSpawn(script.def.id);
    for (let tick = 0; tick < 160; tick++) host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0 }));
    expect(script.program.failure).toBeNull();
    const ids = ['rival0', 'rival1'].map(slot => script.program.body(slot)?.entityId);
    expect(ids.every(id => id !== undefined)).toBe(true); expect(new Set(ids).size).toBe(2);
    const before = script.program.snapshot(), calls = script.program.host.metrics().map(row => row.calls);
    const commit = script.program.prepareRestore(before); expect(script.program.snapshot()).toBe(before); commit();
    expect(script.program.snapshot()).toBe(before); expect(script.program.host.metrics().map(row => row.calls)).toEqual(calls);
    const bad = v.parse(v.record(v.string(), v.unknown()), JSON.parse(before));
    const actors = v.parse(v.array(v.tuple([v.number(), v.string()])), bad['actors']);
    const first = actors[0], second = actors[1]; if (first === undefined || second === undefined) throw new Error('Missing actors');
    second[1] = first[1]; bad['actors'] = actors;
    expect(() => script.program.prepareRestore(JSON.stringify(bad))).toThrow(); expect(script.program.snapshot()).toBe(before);
    expect(['rival0', 'rival1'].map(slot => script.program.body(slot)?.entityId)).toEqual(ids);
    const previousMain = script.animal;
    previousMain.alive = false; feature.core.devSpawn(script.def.id);
    expect(script.animal.entityId).not.toBe(previousMain.entityId);
    expect(['rival0', 'rival1'].map(slot => script.program.body(slot))).toEqual([null, null]);
    for (let tick = 0; tick < 180; tick++) host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0 }));
    expect(script.program.failure).toBeNull();
    expect(['rival0', 'rival1'].map(slot => script.program.body(slot)?.entityId).every(id => id !== undefined && !ids.includes(id))).toBe(true);
  } finally { host.dispose(); }
}, 10_000);

test('ending a concealed encounter restores visibility before saving', async () => {
  const { host, feature } = await fixture();
  try {
    const ghost = feature.scripts.find(row => row.def.id === 'ghost-stag');
    if (ghost?.animal === null || ghost === undefined) throw new Error('Missing stag');
    feature.core.devSpawn(ghost.def.id); leadPlayer(host).position.copy(ghost.animal.position); leadPlayer(host).position.z += 8;
    ghost.force('fade');
    for (let tick = 0; tick < 8; tick++) host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0 }));
    const body = ghost.animal; if (!('hidden' in body)) throw new Error('Missing visibility owner');
    expect(body.hidden).toBe(true); ghost.trophy(); expect(body.hidden).toBe(false);
    const saved = ghost.program.snapshot(); ghost.program.prepareRestore(saved)(); expect(body.hidden).toBe(false);
  } finally { host.dispose(); }
}, 10_000);

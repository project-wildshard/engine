import { populationEnvironment } from '../src/server/game/population/environment';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { pineShelter as shelterProgram } from './fixtures/engine-lift/pins';
import { fixtureNativeRoster } from './fixtures/native-roster';
import { flatPopulationEnvironment } from './fixtures/population-environment';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual shipped native physics owner, without a browser.
import { readSpeciesPrograms } from '@wildshard/format/speciesPrograms';
import { parseWeatherProgram } from '@wildshard/format/weatherProgram';
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { installPopulationRoster } from '../src/server/game/population/roster';
import { HerdShelter,installNativeHerdShelter } from '../src/server/game/population/shelter';
import { createNativeCreatureRoster } from '../src/server/game/shardfile/homeKeeper';
import { installWeatherContinuation } from '../src/server/game/weather/continuation';
import { Rng } from '../src/shared/engine/core/rng';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { RespawnQueue } from '../src/shared/game/population/respawn';
import weatherRows from './fixtures/engine-lift/pine-weather.json' with { type: 'json' };
import { SIM_LEVEL } from './fixtures/sim-level/level';

test('native dormant bodies detach from physics and herds, then rematerialize without a draw or new identity', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier }), rng = new Rng(17);
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing native fixture body');
  const { hunt, services } = fixtureNativeRoster(host, rng);
  hunt.addHerd(sample.spec.kind, 0, 0);
  const herd = hunt.herds[0]; if (herd === undefined) throw new Error('Missing herd');
  const intake = createNativeCreatureRoster(host, { specs: [sample.spec], variants: new Map(), rng, spawnY: 0,
    hunted: 'every', services });
  try {
    const id = intake.identities.allocate(), body: Parameters<typeof intake.arrive>[0] = intake.body(id, sample.spec.kind, sample.spec.variant, 0, { x: 4, z: 4 }, 0, [1, 1], { seed: .25, scale: 1 });
    const actor = intake.arrive(body), before = rng.snapshot();
    expect(intake.identities.identity(id)).toEqual({ id, kind: sample.spec.kind, variant: sample.spec.variant,
      group: 'herd:0', encounter: null, listed: true, state: 'materialized' });
    intake.identities.adoptAuxiliary({ id: 'marsh.sensor', actor: id, service: 'marsh.traps', handle: 42 });
    expect(() => intake.sleep(body)).toThrow('auxiliary');
    expect(body.actor).toBe(actor); expect(herd.members).toEqual([actor]); expect(host.entities.has(id)).toBe(true);
    intake.identities.releaseAuxiliary('marsh.sensor');
    intake.sleep(body);
    expect(body.actor).toBeNull(); expect(herd.members).toEqual([]); expect(host.entities.has(id)).toBe(false);
    expect(intake.identities.identity(id)?.state).toBe('dormant');
    const adopted = intake.arrive(body);
    expect(adopted).not.toBe(actor); expect(adopted.entityId).toBe(id); expect([adopted.seed, adopted.scale]).toEqual([.25, 1]);
    expect(herd.members).toEqual([adopted]); expect(rng.snapshot()).toEqual(before);
    intake.retire(body); expect(intake.identities.identity(id)?.state).toBe('retired');
    expect(() => intake.arrive(body)).toThrow('identity'); expect(host.entities.has(id)).toBe(false);
  } finally { host.dispose(); }
});

test('made-up salt-marsh roster reserves and adopts a body without draws and resumes its v3 wire', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing native fixture body');
  const spec = { ...sample.spec, kind: 'marsh-beast', variant: 'reed' }, rng = new Rng(87);
  const roll = (id: string) => {
    const scale = rng.range(1, 2); rng.next(); const seed = rng.next(); rng.next(); rng.next(); rng.next();
    return { id, kind: spec.kind, variant: spec.variant, spec, seed, scale, scripted: true };
  };
  const reserved = roll('creature:0'), home = roll('creature:1');
  const population = readSpeciesPrograms({ page: [], native: [{ id: spec.kind, kind: spec.kind, label: 'Marsh Beast',
    variants: [{ id: spec.variant, label: 'Reed', weight: 1, rarity: 'common', scale: [1, 2] }] }],
    hunt: { limit: 8, player: 'host', fight: {}, bands: { states: [], legacyKinds: [] }, hit: { namespace: 'marsh', tags: [] } } });
  const rows = { version: 1, environment: 'fixture.habitat', step: 'marsh.roster', seed: 87, bodyCount: 1, limit: 8, scripted: 'sidestep', encounter: 'dusk.guard',
    poseKinds: [], fauna: [], spawn: { x: 0, z: 0 }, identities: [], ordinary: {},
    reserves: [{ kind: spec.kind, variant: spec.variant }], homes: [{ kind: spec.kind, variant: spec.variant, x: 8, z: 8, stream: 'marsh.guard' }] };
  const make = () => { const native = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier }); flatPopulationEnvironment(native); return native; };
  const host = make();
  try {
    const ports = { population, bake: { actors: [home], parked: [reserved], herds: [] }, spawnY: 10, nav: null };
    const roster = installPopulationRoster(host, ports, rows);
    expect(roster.bodies().map(body => body.id)).toEqual(['creature:1']);
    const before = snapshotSimHost(host), own = before.adapters.find(adapter => adapter.id === 'marsh.roster');
    expect(own?.state).toMatchObject({ rng: rng.snapshot(), next: 2 });
    const actor = roster.adoptParked('creature:0', 6, 7, 0);
    expect(actor.entityId).toBe('creature:0'); expect(roster.bodies()).toHaveLength(1);
    expect(snapshotSimHost(host).adapters.find(adapter => adapter.id === 'marsh.roster')?.state).toEqual(own?.state);
    const saved = snapshotSimHost(host);
    let continued: ReturnType<typeof installPopulationRoster> | undefined;
    const restored = restoreSimHost({ ...SIM_LEVEL, entities: [] }, { rapier }, saved, native => {
      flatPopulationEnvironment(native);
      continued = installPopulationRoster(native, { ...ports, saved }, rows);
    });
    try {
      if (continued === undefined) throw new Error('Missing restored population');
      expect(snapshotSimHost(restored)).toEqual(saved);
      expect(continued.actor('creature:0')).not.toBeNull();
      const first = roster.spawn(spec.kind, 10, 10, 0, spec.variant), second = continued.spawn(spec.kind, 10, 10, 0, spec.variant);
      expect(first.entityId).toBe('creature:2'); expect(second.entityId).toBe(first.entityId);
      expect([second.seed, second.scale]).toEqual([first.seed, first.scale]);
    } finally { restored.dispose(); }
  } finally { host.dispose(); }
});

test('made-up marsh rows shelter a flock and return nocturnal bodies in reverse death order', () => {
  const herds = [{ kind: 'heron', cx: 4, cz: 0, members: [] }];
  const shelter = new HerdShelter({ herds }, [{ x: 0, z: 0, r: 1, height: 8, cover: 1 }],
    { kinds: ['heron'], bigTree: 5, reach: 20, homeHold: 2, clear: 1, spotR: 2, homeR: 4, wet: .4, dry: .2, heightBias: 1, coverBias: 2 }, ReturnProgram.page(shelterProgram));
  shelter.update(1, 1); expect(shelter.wanderGoal(0, 1)).toEqual({ x: 2, z: 0, r: 2 });
  const saved = shelter.snapshot(); shelter.restore(saved); expect(shelter.snapshot()).toEqual(saved);
  const queue = new RespawnQueue({ heron: { delay: { min: 2, max: 2 }, night: true } }, 10);
  const first = queue.add('heron', 'reed', 0, 20, 0, 0, .25), second = queue.add('heron', 'white', 0, 25, 0, 0, .25);
  expect(queue.take(3, 0, 0, 0)).toEqual([]); expect(queue.take(3, 20, 0, 1)).toEqual([]);
  expect(queue.take(3, 0, 0, 1)).toEqual([second, first]);
});


test('native shelter resolves its actual roster and weather without ports, preserving its v1 step and wire', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier });
  flatPopulationEnvironment(host);
  const weather = parseWeatherProgram(weatherRows), step = weather.air?.step;
  if (step === undefined) throw new Error('Missing native weather cadence');
  const air = installWeatherContinuation(host, weather, { phase: 0 }, 'rain');
  const look = { kinds: ['marsh-beast'], bigTree: 5, reach: 20, homeHold: 3, clear: 1, spotR: 2, homeR: 6, wet: .3, dry: .1, heightBias: 0, coverBias: 0 };
  const rows = { environment: 'fixture.habitat', step: 'marsh.shelter', roster: 'marsh.roster', weather: step, herdLimit: 8, look, program: shelterProgram };
  const shelter = installNativeHerdShelter(host, [[0,0,1,8,1]], rows);
  try {
    expect(() => shelter.snapshot()).toThrow('Missing native population service');
    const population = readSpeciesPrograms({ page: [], native: [], hunt: { limit: 8, player: 'host', fight: {}, bands: { states: [], legacyKinds: [] }, hit: { namespace: 'marsh', tags: [] } } });
    const roster = installPopulationRoster(host, { population, bake: { actors: [], parked: [], herds: [] }, spawnY: 0, nav: null },
      { version: 1, environment: 'fixture.habitat', step: rows.roster, seed: 71, bodyCount: 0, limit: 8,
        scripted: 'sidestep', encounter: 'marsh', poseKinds: [], spawn: { x: 0, z: 0 }, fauna: [], identities: [], ordinary: {}, reserves: [], homes: [] });
    roster.hunt.addHerd('marsh-beast', 4, 0);
    host.step();
    expect(populationEnvironment(host, rows.environment).wanderGoals[0]).toEqual(shelter.wanderGoal(0,air.rain));
    const before = shelter.snapshot();
    expect(before.version).toBe(1); expect(before.shelters).toHaveLength(1);
    shelter.restore(before); expect(shelter.snapshot()).toEqual(before);
    const ids = snapshotSimHost(host).adapters.map(row => row.id);
    expect(ids.indexOf(rows.step)).toBeLessThan(ids.indexOf(rows.roster));
  } finally { host.dispose(); }
});

import { flatPopulationEnvironment } from './fixtures/population-environment';
// oxlint-disable-next-line import/no-nodejs-modules -- Scenario uses the shipped Rapier binary.
import { parseSpawnScript } from '@wildshard/format/spawnScripts';
import { readSpeciesPrograms } from '@wildshard/format/speciesPrograms';
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { beforeAll,expect,test,vi } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { installPopulationRoster } from '../src/server/game/population/roster';
import { installNativeSpawnScript,SpawnScript } from '../src/server/game/population/spawnScript';
import { Rng } from '../src/shared/engine/core/rng';
import type { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { loadRapier,type Rapier } from '../src/shared/engine/physics/rapier';
import { pineNightBytes as PINE_NIGHT_MODULE,pineSpecies as PINE_SPECIES_PROGRAMS,pineNight as rawNight } from './fixtures/engine-lift/pins';
import { SIM_LEVEL } from './fixtures/sim-level/level';

const moduleBytes=Uint8Array.from(PINE_NIGHT_MODULE);
const encode=(bytes:Uint8Array):string=>btoa(String.fromCodePoint(...bytes));
// The original inline fixture remains the independent execution/save oracle.
const night={...rawNight,bytes:encode(moduleBytes)};
const active = { draws: 0, created: [] as AnimalSim[] };
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });
function scenario(rosterStep = 'pine.roster', program: unknown = night, raw = false) {
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier });
  active.draws = 0; active.created = [];
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing fixture recipe');
  const native = PINE_SPECIES_PROGRAMS.native[0]; if (native === undefined) throw new Error('Missing species row');
  const population = readSpeciesPrograms({ page: [], hunt: PINE_SPECIES_PROGRAMS.hunt, native: [...PINE_SPECIES_PROGRAMS.native,
    { ...native, id: 'marsh.heron', kind: 'heron', variants: [{ id: 'reed', label: 'Heron', weight: 1, rarity: 'common' as const, scale: [1, 1] }] }] });
  const parked = [['elk', 'thrall'], ['boar', 'thrall'], ['heron', 'reed']].map(([kind, variant], i) => {
    if (kind === undefined || variant === undefined) throw new Error('Missing species recipe');
    return Object.assign(structuredClone(sample), { id: `recipe.${String(i)}`, kind, variant, spec: { ...sample.spec, kind, variant } });
  });
  flatPopulationEnvironment(host);
  const step = rosterStep; installPopulationRoster(host, { population, nav: null,
    spawnY: 20, bake: { actors: [], parked, herds: [] } }, {
    version: 1, environment: 'fixture.habitat', step, seed: 1368, bodyCount: 0, limit: 512, scripted: 'sidestep', encounter: 'test', poseKinds: [],
    spawn: { x: 0, z: 0 }, fauna: [], identities: [], ordinary: {}, reserves: [], homes: [],
  });
  const spawn = host.spawn.bind(host);
  vi.spyOn(host, 'spawn').mockImplementation(recipe => {
    const body = spawn(recipe); active.created.push(body); active.draws += 6; return body;
  });
  const runner = SpawnScript.native(host, { ...parseSpawnScript(program), roster: rosterStep },raw?{scope:host.scope,module:moduleBytes}:undefined);
  const point = { x: 150, y: 0, z: -40 };
  return { host, runner, point, run: (ticks: number, dark = 1, flags: string[] = []) => {
    for (let i = 0; i < ticks; i++) {
      runner.advance(1 / 60, point, dark, 3, flags);
      if (runner.hasFlag('errand:done') && !flags.includes('errand:done')) flags.push('errand:done');
    }
  } };
}

test('night v1 places roamers, retains IDs and draws, flees dawn and restores without guest calls', () => {
  const { host, runner, point, run } = scenario();
  try {
    run(60); expect(runner.channel(1)).toBe(0);
    run(1); expect(runner.channel(1)).toBe(1);
    run(60); expect(runner.channel(1)).toBe(2);
    run(60);
    expect(runner.failure).toBeNull(); expect(runner.host.metrics()[0]?.refusals).toBe(0);
    expect(runner.channel(1)).toBe(3); expect(active.created).toHaveLength(3); expect(active.draws).toBe(18);
    const before = runner.snapshot(), ids = active.created.map(actor => actor.entityId), draws = active.draws;
    const restored = SpawnScript.native(host, night); restored.restore(before);
    expect(restored.host.metrics()[0]?.calls).toBe(0); expect(restored.snapshot()).toBe(before);
    const events = [];
    for (let i = 0; i < 245; i++) { restored.advance(1 / 60, point, 0, 3, []); events.push(...restored.drainEffects()); }
    expect(restored.channel(1)).toBe(0); expect(ids.every(id => !host.entities.has(id))).toBe(true);
    expect(events.filter(event => event.kind === 'cue' && event.id === 4)).toHaveLength(3);
    expect(active.draws).toBe(draws); expect(restored.failure).toBeNull(); expect(restored.host.metrics()[0]?.refusals).toBe(0);
  } finally { host.dispose(); }
});

test('spawn provenance preserves pre-hash saves without accepting executable row drift', () => {
  const rows = parseSpawnScript(night), { sourceHash: _sourceHash, ...script } = rows.script;
  const { host, runner, run } = scenario('pine.roster', { ...rows, script });
  try {
    run(181); const saved = runner.snapshot(), draws = active.draws;
    for (const sourceHash of ['a'.repeat(64), 'b'.repeat(64), undefined]) {
      const restored = SpawnScript.native(host, { ...rows, script: { ...script, ...(sourceHash === undefined ? {} : { sourceHash }) } });
      restored.restore(saved);
      expect(restored.snapshot()).toBe(saved); expect(restored.host.metrics().every(row => row.calls === 0)).toBe(true);
      expect(active.draws).toBe(draws); expect(restored.drainEffects()).toEqual([]);
    }
    for (const change of [{ module: `blobs/wasm/${'f'.repeat(64)}.wasm` }, { params: { ...script.params, changed: 1 } },
      { stateVersion: script.stateVersion + 1 }, { onFail: 'reset' as const }]) {
      const incompatible = SpawnScript.native(host, { ...rows, script: { ...script, ...change } }), before = incompatible.snapshot();
      expect(() => incompatible.restore(saved)).toThrow('Incompatible population script continuation');
      expect(incompatible.snapshot()).toBe(before);
    }
  } finally { host.dispose(); }
});

test('millrace wakes on approach, finishes once after all three die, and allows no dawn respawn', () => {
  const { host, runner, point, run } = scenario();
  try {
    point.x = -181; point.z = -144;
    run(80, 1, ['errand:asked']);
    expect(runner.failure).toBeNull(); expect(runner.host.metrics()[0]?.refusals).toBe(0);
    expect(active.created).toHaveLength(3); expect(active.created.every(actor => actor.scripted)).toBe(false);
    for (const actor of active.created) actor.alive = false;
    run(70, 0, ['errand:asked']); expect(runner.hasFlag('errand:done')).toBe(true);
    expect(runner.channel(1)).toBe(0); expect(active.draws).toBe(18);
  } finally { host.dispose(); }
});

test('G565: the script gates the millrace on its own declared quest flags (a done errand never races again)', () => {
  const { host, runner, point, run } = scenario();
  try {
    point.x = -181; point.z = -144;
    run(80, 1, ['errand:asked', 'errand:done']);
    expect(runner.failure).toBeNull(); expect(active.created).toHaveLength(0); expect(runner.channel(1)).toBe(0);
  } finally { host.dispose(); }
});

test('legacy mid-night identities and placement stream migrate without spawn or guest execution', () => {
  const { host, runner, point, run } = scenario();
  try {
    runner.force(); run(31);
    const rows = parseSpawnScript(night); if (rows.legacy === undefined) throw new Error('Missing old-save map');
    const rng = new Rng(rows.seed).fork(rows.step), oldActors = active.created.slice();
    const ids = oldActors.map(actor => actor.entityId), before = active.draws;
    const old = { version: 1, population: { version: 2, spec: rows.legacy.spec, director: 'legacy checkpoint', acc: .4,
      roam: ids.map(id => ({ id, flee: .6 })), race: [] }, rng: { ...rng.snapshot() } };
    const restored = installNativeSpawnScript(host, { night: 0 }, night);
    const adapter = host.adapters.get('pine.night'); if (adapter === undefined) throw new Error('Missing save owner');
    adapter.restore(old); expect(adapter.snapshot()).toEqual(old);
    expect(restored.host.metrics()[0]?.calls).toBe(0); expect(active.draws).toBe(before);
    expect(restored.host.state(1)['rng']).toBe(rng.snapshot().state); expect(restored.host.state(1)['acc']).toBe(.4);
    for (let i = 0; i < 185; i++) restored.advance(1 / 60, point, 0, 3, []);
    expect(restored.channel(1)).toBe(0); expect(ids.every(id => !host.entities.has(id))).toBe(true);
    expect(active.draws).toBe(before); expect(restored.failure).toBeNull(); expect(restored.host.metrics()[0]?.refusals).toBe(0);
  } finally { host.dispose(); }
});

test('bad spawn recipes and forged saves refuse atomically without draws or guest calls', () => {
  const { host, runner, run } = scenario();
  try {
    runner.force(); run(19);
    const before = runner.snapshot(), calls = runner.host.metrics()[0]?.calls, drawn = active.draws;
    const saved: unknown = JSON.parse(before);
    if (typeof saved !== 'object' || saved === null) throw new Error('Missing saved population');
    for (const forged of [
      { ...saved, fields: [[123, 1, 0]] }, { ...saved, channels: [[123, 1]] },
      { ...saved, actors: [[1, 'foreign']] }, { ...saved, force: -1 },
    ]) {
      expect(() => runner.restore(JSON.stringify(forged))).toThrow(); expect(runner.snapshot()).toBe(before);
      expect(runner.host.metrics()[0]?.calls).toBe(calls); expect(active.draws).toBe(drawn);
    }
    expect(() => SpawnScript.native(host, { ...night, species: [{ id: 'elk', kind: 'elk', variant: 'missing' }, night.species[1]] })).toThrow();
    expect(active.draws).toBe(drawn); expect(runner.snapshot()).toBe(before);
  } finally { host.dispose(); }
});


test('published spawn catalogue admits v1 bytes without installing a second generic decision owner', async () => {
  const { loadHeadlessProduct } = await import('@wildshard/engine/host/headlessProduct');
  const { readSpawnScript } = await import('../src/server/game/population/spawnScript');
  const { scriptAdmissionRows, decisionScriptsFromSections } = await import('@wildshard/format/scriptContract');
  const { SpawnScriptsSchema } = await import('@wildshard/format/spawnScripts');
  const { sectionHostImports } = await import('../scripts/shard-platform-hosts.mjs');
  expect(sectionHostImports([{ name: 'actors/spawn-scripts' }])).toContain('game/server/population/spawnScript');
  const product = await loadHeadlessProduct('out/pine-hollow');
  const catalogue = product.section('actors/spawn-scripts');
  const rows = new Map<string, unknown>([['actors/spawn-scripts', catalogue], ['sim/scripts', product.section('sim/scripts')]]);
  expect(scriptAdmissionRows(rows).some(row => row.id === 'pine.night')).toBe(true);
  expect(decisionScriptsFromSections(rows).some(row => row.id === 'pine.night')).toBe(false);
  expect(catalogue.every(row => row.bytes === '')).toBe(true);
  expect(() => v.parse(SpawnScriptsSchema, [{ ...night }])).toThrow();
  const admitted = await readSpawnScript(product, 'pine.night');
  expect(admitted.seed).toBe(product.shardfile.identity.seed);
  expect(admitted.bytes).toBe(night.bytes); expect(admitted.script.module).toBe(night.script.module);
  const { host } = scenario();
  try {
    const runner = SpawnScript.native(host, admitted); runner.force();
    for (let i = 0; i < 31; i++) runner.advance(1 / 60, { x: 150, y: 0, z: -40 }, 1, 3, []);
    // The native seed's three bounded placement requests accept exactly two sites here.
    expect(runner.channel(1)).toBe(2); expect(active.draws).toBe(12); expect(runner.failure).toBeNull();
  } finally { host.dispose(); }
});

test('in a room the night reads the player nearest its bodies, not the first', () => {
  const { host } = scenario();
  try {
    const live = installNativeSpawnScript(host, { night: 1 }, { ...parseSpawnScript(night), roster: 'pine.roster' });
    for (let tick = 0; tick < 200; tick++) host.step();
    const body = active.created[0]; if (body === undefined) throw new Error('The night sent nobody');
    expect(live.standing).toBe(body.position);
    const lead = [...host.players.values()][0], bot = host.addPlayer('bot:1', { x: body.position.x + 2, y: body.position.y, z: body.position.z });
    const advance = vi.spyOn(live, 'advance');
    host.step();
    expect(advance.mock.lastCall?.[1], 'the bot stands by the body').toBe(bot.position);
    bot.position.set(body.position.x + 900, bot.position.y, body.position.z); host.step();
    expect(advance.mock.lastCall?.[1], 'and when it walks off the first player is nearer').toBe(lead?.position);
  } finally { host.dispose(); }
});

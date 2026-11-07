import { admissionNative } from './fixtures/engine-lift/pins';


// oxlint-disable-next-line import/no-nodejs-modules -- Native host fixture uses the shipped physics binary.
import { leadCommands } from '@wildshard/engine/sim/leadPlayer';
import { parseWeatherProgram } from '@wildshard/format/weatherProgram';
import { zlibSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { nativeEliteBindings as eliteBindings } from '../src/server/engine/ai/eliteRoster';
import { createSimHost } from '../src/server/engine/sim';
import { NativePopulationField } from '../src/server/game/population/environment';
import { NativeWildEnvironment } from '../src/server/game/population/nativeManager';
import { installNativeBootRoster } from '../src/server/game/riding/nativePopulation';
import { installWeatherContinuation } from '../src/server/game/weather/continuation';
import { nativeWeatherBundle } from '../src/server/game/weather/reactions';
import { Rng } from '../src/shared/engine/core/rng';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import pine from './fixtures/engine-lift/pine-weather.json' with { type: 'json' };
import { weatherWitness as storm } from './fixtures/engine-lift/pins';
import { SIM_LEVEL } from './fixtures/sim-level/level';

const raster = (values: readonly number[],file:string) => ({row:{type:'f32',count:values.length,data:{file}},block:{file,bytes:zlibSync(new Uint8Array(Float32Array.from(values).buffer))}});
const wet=raster([1,1,1,1],'test/orchard-wet.bin'),pond=raster([0,0,0,0],'test/orchard-pond.bin');
const grid = { res: 2,size: 32,seed: 9,landscapeHash: 0,heights: new Float32Array(4),splat: Uint8Array.from([255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0]),undergrowth: null };
const fieldRows = { seed: 9,world: { res: 2,size: 32,water: -10,wet: wet.row,pond: pond.row },
  trails: [],river: { from: -16,step: 32,values: [[8,1],[8,1]] },meadow: { short: [],tall: [],bare: [],valley: .5,plateau: .6 } };

test('orchard native boot joins its own bake, raster senses and weather continuation', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const host = createSimHost({ ...SIM_LEVEL,entities: [],quests: [] },{ rapier }), sample = SIM_LEVEL.entities[0];
  if (sample === undefined) throw new Error('Missing orchard actor');
  try {
    const field = new NativePopulationField(grid,fieldRows,[[3,4,1]],[12],pond.block,wet.block), stream = new Rng(9).snapshot();
    expect(field.hunt.wetAt(0,0)).toBe(true); expect(field.queries.surfaceAt(0,0)).toBeNull();
    expect(field.queries.inBounds(16,0,0)).toBe(false); expect(field.hunt.inChunk(16,0,0)).toBe(true);
    expect(field.trees.nearby(3,4,1)[0]?.top).toBe(12); expect(field.grass.field.baseHeightAt(0,0)).toBeGreaterThan(0);
    const body = { id: 'orchard.guard',kind: sample.spec.kind,variant: { id: sample.spec.variant },seed: 3,scale: 1,herd: -1,position: { x: 3,z: 4 },yaw: 0,adopted: { stream,x: 3,z: 4 } };
    const bake = { actors: [{ id: body.id,kind: body.kind,variant: body.variant.id,seed: 3,scale: 1,herd: -1,spec: sample.spec,scripted: false }],herds: [] };
    const boot = { admission: {},pasture: {},streamSeed: 9,phases: ['day'],hunt: {},species: {},recipes: [],roster: { bodies: [body],herds: [],stream,wildStream: stream } };
    const roster = installNativeBootRoster(host,{ boot,bake,field,spawnY: 5,clock: { phase: 'day',storm: false },elites: eliteBindings() });
    expect(roster.bodies[0]?.actor.entityId).toBe(body.id); expect(roster.bodies[0]?.actor.position.x).toBe(3);
    expect(roster.stream).toEqual(stream);
    const program = parseWeatherProgram({ ...pine,registers: { ...pine.registers,ready: 0,armed: 0,wait: 0,flash: 0,bearing: 2,low: 0,lowFor: 0 } });
    const reactions = { version: 1,hz: 5,script: storm.script,bytes: storm.bytes,active: ['rain'],flash: 'flash',shelter: { margin: 1,circles: [] },points: [],steps: [{ signal: 'tick',observe: [['dt','dt'],['armed','register.armed'],['pendingT','register.wait'],['ready','register.ready'],['storm','state.rain'],['gust','state.rain'],['bearing','register.bearing'],['flash','register.flash']],random: true,write: [['flash','register.flash']],emit: [] }] };
    const env = new NativeWildEnvironment(field.grass.field,field.grass.trample,{ wind: { x: 1,z: 0,strength: .5 },flatten: .5 },admissionNative(host));
    const weather = installWeatherContinuation(host,{ program: nativeWeatherBundle({ weather: program,reactions }),clock: { sunElevation: 0 },env,
      bake: { trees: [[3,4,1]],tops: [12] },rows: { step: 'orchard.weather',scareRadius: 20,windReference: 8,
        light: { base: .2,storm: .4,ramps: [[-10,10,.6]] },hit: { ask: 'weather.damage',tags: ['env.rain'],cause: { kind: 'rain',label: 'Rain',text: 'Rain' },toast: 'Rain' } } });
    expect(env.light).toBeCloseTo(.5); weather.storm.weather.force('rain',.2); weather.storm.weather.hold = true;
    for (let tick = 0; tick < 12; tick++) host.step(leadCommands(host, { moveX: 0,moveZ: 0,yaw: 0 }));
    expect(env.storm).toBe(true); expect(env.light).toBe(.4);
    const adapter = host.adapters.get('orchard.weather'); if (adapter === undefined) throw new Error('Missing weather continuation');
    const saved = adapter.snapshot(); host.step(leadCommands(host, { moveX: 0,moveZ: 0,yaw: 0 })); adapter.restore(saved); expect(adapter.snapshot()).toEqual(saved);
  } finally { host.dispose(); }
});

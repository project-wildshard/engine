import { admissionNative } from './fixtures/engine-lift/pins';


// oxlint-disable-next-line import/no-nodejs-modules -- Native host fixture uses the shipped physics binary.
import { zlibSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { netClimate } from '../src/client/game/weather/netClimate';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost } from '../src/server/engine/sim';
import { NativePopulationField } from '../src/server/game/population/environment';
import { NativeWildEnvironment } from '../src/server/game/population/nativeManager';
import { installWeatherContinuation } from '../src/server/game/weather/continuation';
import { nativeWeatherBundle } from '../src/server/game/weather/reactions';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import nalati from './fixtures/engine-lift/nalati-weather.json' with { type: 'json' };
import { weatherWitness } from './fixtures/engine-lift/pins';
import { SIM_LEVEL } from './fixtures/sim-level/level';

const raster = (values: readonly number[], file: string) => ({ row: { type: 'f32', count: values.length, data: { file } }, block: { file, bytes: zlibSync(new Uint8Array(Float32Array.from(values).buffer)) } });
const wet = raster([0, 0, 0, 0], 'test/storm-wet.bin'), pond = raster([0, 0, 0, 0], 'test/storm-pond.bin');
const grid = { res: 2, size: 64, seed: 9, landscapeHash: 0, heights: new Float32Array(4), splat: Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]), undergrowth: null };
const fieldRows = { seed: 9, world: { res: 2, size: 64, water: -10, wet: wet.row, pond: pond.row },
  trails: [], river: { from: -32, step: 64, values: [[8, 1], [8, 1]] }, meadow: { short: [], tall: [], bare: [], valley: .5, plateau: .6 } };
const worldRows = { step: 'storm.weather', scareRadius: 20, windReference: 8, light: { base: .2, storm: .4, ramps: [[-10, 10, .6]] },
  hit: { ask: 'weather.damage', tags: ['env.storm'], cause: { kind: 'storm', label: 'Lightning', text: 'Lightning' }, toast: 'Lightning' } };

// E6 WORLD: the climate port fed off the wire reads what the server's own sky holds, and a storm's events reach its view.
test('a view reads the server sky off the wire, and hears its bolts', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  try {
    const field = new NativePopulationField(grid, fieldRows, [[3, 4, 1]], [12], pond.block, wet.block);
    const env = new NativeWildEnvironment(field.grass.field, field.grass.trample, { wind: { x: 1, z: 0, strength: .5 }, flatten: .5 }, admissionNative(host));
    const bundle = nativeWeatherBundle({ weather: nalati, reactions: weatherWitness }, [[20, 20, 4]]);
    const { storm } = installWeatherContinuation(host, { program: bundle, clock: { sunElevation: 0 }, env, scare: () => undefined, bake: { trees: [[3, 4, 1]], tops: [12] }, rows: worldRows });
    const link = directLoopback(), client = new NetClient(link.client), room = new NetRoom({ world: new SimNetWorld(host), step: () => { host.step(); } });
    room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
    const climate = netClimate(client, { weather: bundle.weather, reactions: bundle.reactions }, () => undefined), sky = storm.weather, heard: number[] = [];
    climate.storm?.on('strike', event => { heard.push(event['x'] ?? 0); });
    const run = (ticks: number): void => { for (let tick = 0; tick < ticks; tick++) { room.tick(); link.pump(); climate.frame(1 / 60, null); } };
    run(4);
    sky.force('storm', 1); run(240);
    expect(climate.weather.state).toBe(sky.state);
    expect(climate.weather.rain).toBeCloseTo(sky.rain, 1); expect(climate.weather.overcast).toBeCloseTo(sky.overcast, 1);
    expect(climate.weather.fog).toBeCloseTo(sky.fog, 1); expect(climate.weather.wet).toBeCloseTo(sky.wet, 1);
    expect(Math.abs(climate.weather.phaseLeft - sky.phaseLeft)).toBeLessThanOrEqual(1.1);
    expect(climate.storm?.stormActive).toBe(storm.stormActive);
    // the same bolt as the rows raise it, once
    const lead = [...host.players.values()][0]; if (lead === undefined) throw new Error('Missing lead');
    Object.assign(sky.registers, { sx: lead.position.x, sy: lead.position.y, sz: lead.position.z, skind: 3, armed: 1, pendingT: .001, land: 0, ready: 0 });
    run(12);
    expect(heard).toHaveLength(1); expect(heard[0]).toBeCloseTo(storm.record('strike')['x'] ?? Number.NaN);
    expect(climate.storm?.record('strike')['x']).toBeCloseTo(storm.record('strike')['x'] ?? Number.NaN);
    expect(client.dropped).toBe(0);
  } finally { host.dispose(); }
});

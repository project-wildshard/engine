import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { installDeclaredClimate } from '../src/server/game/shardfile/declaredClimate';
import { shardRows } from '../src/shared/engine/sim/shardRows';

// ONE-FORMAT OF41a (Q-S6, J367 (4)): the `sky` and `weather` primitives, opened as they are, run from a plain upload's
// `world/days` and `world/weather` rows (the room installs them, `cellWorld.ts`), with no native host.
const day = { id: 'fixture.day', units: 'hour', start: 12, schedule: [{ phase: 'day', from: 0, to: 24, minutes: 12 }],
  sun: { maxElevation: 60, azimuthOffset: 35 }, fixed: { midday: 12, golden: 17, sunset: 18, night: 0 }, presets: { dawn: 6, noon: 12, dusk: 18, night: 0 } };
const calm = { overcast: 0, rain: 0, wet: 0, wind: 0.1, fog: 0 };
const weather = { id: 'fixture.weather', initial: calm, soak: 0.1, dry: 0.1,
  modes: [{ id: 'live', hold: null, at: 0, dry: false }],
  states: [{ id: 'clear', next: 'cloudy', length: [2, 2], numbers: calm }, { id: 'cloudy', next: 'clear', length: [30, 30], numbers: { ...calm, overcast: 0.5 } }] };
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
function climateShard(declared: boolean) {
  const base = emptyShardfile({ slug: 'climate-fixture', name: 'Climate fixture', author: 'Test', revision: 1, seed: 9 });
  const rows = parseRows({ weather: declared ? [weather] : [], days: declared ? [day] : [], compendiums: [], loot: [], strikes: [], looks: [], species: [] });
  return { ...base, rows };
}
const read = (sim: ReturnType<typeof createShardfileSim>, name: string): readonly { readonly name: string; readonly value: number }[] => shardRows(sim.host).world.get(name)?.() ?? [];

test('OF41a: plain day and weather rows run the sky and weather primitives: the day turns and the weather moves on', () => {
  const sim = createShardfileSim(climateShard(true), new Map(), { rapier });
  try {
    installDeclaredClimate(sim.host, climateShard(true).rows);
    const noon = read(sim, 'day')[0]?.value, before = read(sim, 'weather')[0]?.value;
    expect(noon).toBeDefined(); expect(before).toBe(0); // the first state, `clear`
    for (let i = 0; i < 60 * 4; i++) sim.host.step();
    expect(read(sim, 'day')[0]?.value).not.toBe(noon);
    expect(read(sim, 'weather')[0]?.value).toBe(1); // `clear` lasts 2 s, then `cloudy`
  } finally { sim.dispose(); }
});

test('OF41a: without the rows nothing is published', () => {
  const sim = createShardfileSim(climateShard(false), new Map(), { rapier });
  try {
    installDeclaredClimate(sim.host, climateShard(false).rows);
    expect(shardRows(sim.host).world.has('day')).toBe(false);
    expect(shardRows(sim.host).world.has('weather')).toBe(false);
  } finally { sim.dispose(); }
});

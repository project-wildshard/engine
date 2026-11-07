import { expect, test, vi } from 'vitest';
import { floorGridPortalPlan, gridFloorWitnessFailures, readFloorGridEntryways, gridFloorPlans, floorGridEntryRoute, type FloorGridPlan, type FloorGridWitness } from '../scripts/frame-floor-grid.mjs';

test('cold home entry selects its return after the outward retirement leg', () => {
  const state = { home: 'home', cells: [
    { instance: 'home', slug: 'driftwood-isle', cell: [0, 0] as const },
    { instance: 'template-2', slug: '_template', cell: [-1, -1] as const },
  ] };
  const plans = gridFloorPlans(state, 'cell', { cell: 'home', roadApproach: true });
  const route = floorGridEntryRoute(plans, 'home');
  expect(route.setup).toHaveLength(1);
  expect(route.setup[0]).toMatchObject({ from: 'home', to: 'template-2', retiredResidents: ['home'] });
  expect(route.entry).toMatchObject({ name: 'driftwood-isle-road-entry', from: 'template-2', to: 'home', requiredResidents: ['home'] });
  expect(floorGridEntryRoute(plans, 'template-2')).toEqual({ setup: [], entry: plans[0] });
  expect(() => floorGridEntryRoute(plans, 'missing')).toThrow('Missing grid entry');
});

test('ordinary cell entry keeps its original single road approach', () => {
  const state = { home: 'home', cells: [
    { instance: 'home', slug: 'driftwood-isle', cell: [0, 0] as const },
    { instance: 'pine', slug: 'pine-hollow', cell: [0, 1] as const },
  ] };
  const plans = gridFloorPlans(state, 'cell', { cell: 'pine', roadApproach: true });
  expect(floorGridEntryRoute(plans, 'pine')).toEqual({ setup: [], entry: plans[0] });
});

test('surface-water entry requires actual water locomotion and an above-water eye', () => {
  const cells = [{ instance: 'island', slug: 'island', cell: [0, 0] as const }];
  const live = { current: null, worldFeet: { x: 0, y: 0.55, z: 277.5 }, crossings: 0, transitions: [], residents: [], gameplayReady: true };
  const result: FloorGridWitness = {
    plan: { name: 'water socket', from: null, to: 'island', waypoints: [{ x: 0, z: 210 }], requiredResidents: ['island'] },
    before: { home: 'island', inside: null, cells, live: { live, crossing: { phase: 'settled', issue: null } } },
    after: { home: 'island', inside: 'island', cells, live: { live: { ...live, current: 'island',
      worldFeet: { x: 0, y: -0.78, z: 210 }, crossings: 1, transitions: [{ from: null, to: 'island' }], residents: ['island'] },
      crossing: { phase: 'settled', issue: null } } },
    trace: [{ seconds: 1, x: 0, y: -0.78, z: 210, current: 'island', gameplayReady: true }], elapsedSeconds: 1,
  };
  const sample = result.trace[0];
  if (sample === undefined) throw new Error('Missing motion fixture');
  expect(gridFloorWitnessFailures(result)).toHaveLength(1);
  for (const mode of ['wading', 'swimming'] as const) {
    sample.water = { mode, surface: 0, eyeY: 0.9 };
    expect(gridFloorWitnessFailures(result)).toEqual([]);
  }
  for (const water of [{ mode: null, surface: 0, eyeY: 0.9 }, { mode: 'swimming', surface: null, eyeY: 0.9 },
    { mode: 'swimming', surface: Number.NaN, eyeY: 0.9 }, { mode: 'swimming', surface: 0, eyeY: -0.1 },
    { mode: 'swimming', surface: 0, eyeY: Number.POSITIVE_INFINITY }, { mode: 'wading', surface: -1, eyeY: 0.9 }] as const) {
    sample.water = water;
    expect(gridFloorWitnessFailures(result)).toHaveLength(1);
  }
  sample.water = { mode: 'swimming', surface: 0, eyeY: 0.9 }; sample.x = Number.NaN;
  expect(gridFloorWitnessFailures(result)).toHaveLength(1);
  sample.x = 0;
  const entering = { ...sample, seconds: 0.75, water: { mode: null, surface: 0, eyeY: 0.9 } };
  result.trace.unshift(entering);
  expect(gridFloorWitnessFailures(result)).toEqual([]);
  entering.water.surface = 0.5;
  expect(gridFloorWitnessFailures(result)).toHaveLength(1);
  entering.water.surface = 0; entering.water.eyeY = -0.1;
  expect(gridFloorWitnessFailures(result)).toHaveLength(1);
});

test('follows the same authored portal with monolithic and sectioned output', async () => {
  const entryways = [{ edge: 'north', kind: 'portalLink', portal: {
    road: { id: 'road', at: [0, 0, 250] }, destination: { id: 'square', at: [0, 125, 20] },
    links: [{ from: 'road', to: 'square' }],
  } }];
  const bytes = new TextEncoder().encode(JSON.stringify({ entryways }));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  const section = { name: 'world/edge', path: 'sections/world/edge.json', schema: 'wildshard:world/edge@1', hash, bytes: bytes.length };
  let root: unknown = { entryways };
  vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
    const path = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    return Promise.resolve(path.endsWith('sections/world/edge.json') ? new Response(bytes) : Response.json(root));
  });
  const path = '/shardfiles/nine-dragon-stack/shard.json';
  const cell = { instance: 'nine', slug: 'nine-dragon-stack', cell: [1, -1] as const };
  const plan: FloorGridPlan = { name: 'entry', from: null, to: 'nine', start: { x: 555, z: -277.5 },
    waypoints: [{ x: 555, z: -345 }], requiredResidents: ['nine'] };
  const monolithic = floorGridPortalPlan(plan, cell, await readFloorGridEntryways(path));
  root = { format: 'wildshard.shardfile', formatVersion: 2, sections: [section] };
  const split = floorGridPortalPlan(plan, cell, await readFloorGridEntryways(path));
  expect(split).toEqual(monolithic);
  expect(split.portal?.destination).toMatchObject({ x: 555, y: 125, z: -535 });
  expect(split.waypoints).toHaveLength(2);
  root = { format: 'wildshard.shardfile', formatVersion: 2, sections: [{ ...section, hash: '0'.repeat(64) }] };
  await expect(readFloorGridEntryways(path)).rejects.toThrow('hash mismatch');
  root = { format: 'wildshard.shardfile', formatVersion: 2, sections: [{ ...section, bytes: bytes.length + 1 }] };
  await expect(readFloorGridEntryways(path)).rejects.toThrow('size mismatch');
});

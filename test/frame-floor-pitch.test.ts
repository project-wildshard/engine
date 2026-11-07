import { expect, test } from 'vitest';
import { floorGridPortalPlan, gridFloorPlans, gridFloorPoses, gridFloorWitnessFailures, type FloorGridState, type FloorGridWitness } from '../scripts/frame-floor-grid.mjs';

const state = { home: 'home', cells: [
  { instance: 'home', slug: 'driftwood-isle', cell: [0, 0] as const },
  { instance: 'template', slug: '_template', cell: [-1, -1] as const },
  { instance: 'pine', slug: 'pine-hollow', cell: [0, 1] as const },
  { instance: 'nalati', slug: 'nalati-grasslands', cell: [1, 0] as const },
] };

test('the default pitch plans and poses equal the 555 m ones', () => {
  expect(gridFloorPlans({ ...state, pitch: 555 }, 'all')).toEqual(gridFloorPlans(state, 'all'));
  expect(gridFloorPoses()).toEqual([
    { name: 'grid-deck-east', x: 277.5, y: 1.7, z: -40, yaw: 0, pitch: -0.08 },
    { name: 'grid-crossroads', x: 277.5, y: 1.7, z: 277.5, yaw: -Math.PI * 0.75, pitch: -0.12 },
    { name: 'grid-deck-north', x: 0, y: 3, z: 262, yaw: Math.PI, pitch: -0.05 },
  ]);
  expect(gridFloorPoses(555)).toEqual(gridFloorPoses());
});

test('562.5 m routes follow observed cell origins and midpoint turn-ins', () => {
  const plans = gridFloorPlans({ ...state, pitch: 562.5 }, 'all');
  expect(plans.map(plan => plan.name)).toEqual(['template-interior', 'template-return', 'pine-interior', 'nalati-interior']);
  expect(plans[0]?.waypoints).toEqual([
    { x: 0, z: -281.25 }, { x: -281.25, z: -281.25 },
    { x: -281.25, z: -562.5 }, { x: -332.5, z: -562.5 },
  ]);
  expect(plans[2]?.waypoints).toEqual([{ x: 0, z: 332.5 }]);
  expect(plans[3]?.waypoints).toEqual([
    { x: 0, z: 281.25 }, { x: 281.25, z: 281.25 }, { x: 281.25, z: 0 }, { x: 332.5, z: 0 },
  ]);
  expect(gridFloorPoses(562.5)).toEqual([
    { name: 'grid-deck-east', x: 281.25, y: 1.7, z: -40, yaw: 0, pitch: -0.08 },
    { name: 'grid-crossroads', x: 281.25, y: 1.7, z: 281.25, yaw: -Math.PI * 0.75, pitch: -0.12 },
    { name: 'grid-deck-north', x: 0, y: 3, z: 265.75, yaw: Math.PI, pitch: -0.05 },
  ]);
});

test.each([Number.NaN, Infinity, 0, 500])('refuses invalid observed pitch %s', pitch => {
  expect(() => gridFloorPlans({ ...state, pitch }, 'all')).toThrow('Invalid grid floor pitch');
  expect(() => gridFloorPoses(pitch)).toThrow('Invalid grid floor pitch');
});

test('declared portals use the observed placement without changing local node coordinates', () => {
  const plan = { name: 'entry', from: null, to: 'tower', start: { x: 562.5, z: -281.25 },
    waypoints: [{ x: 562.5, z: -352.5 }], requiredResidents: ['tower'] };
  const result = floorGridPortalPlan(plan, { instance: 'tower', slug: 'tower', cell: [1, -1] },
    [{ edge: 'north', kind: 'portalLink', portal: {
      road: { id: 'road', at: [0, 0, 250] }, destination: { id: 'square', at: [0, 125, 20] },
      links: [{ from: 'road', to: 'square' }],
    } }], 562.5);
  expect(result.waypoints).toEqual([
    { id: 'road', x: 562.5, y: 0, z: -312.5 }, { id: 'square', x: 562.5, y: 125, z: -542.5 },
  ]);
});

function witness(): FloorGridWitness {
  const before: FloorGridState = { ...state, pitch: 562.5, inside: null, live: {
    crossing: { phase: 'idle', issue: null }, live: { current: null, worldFeet: { x: 281.25, y: 0, z: 0 },
      crossings: 0, transitions: [], residents: [], gameplayReady: true },
  } };
  const after: FloorGridState = { ...before, inside: 'nalati', live: { ...before.live,
    live: { current: 'nalati', worldFeet: { x: 810, y: 0, z: 0 }, crossings: 1,
      transitions: [{ from: null, to: 'nalati' }], residents: ['nalati'], gameplayReady: true },
  } };
  return { plan: { name: 'entry', from: null, to: 'nalati', waypoints: [{ x: 810, z: 0 }], requiredResidents: ['nalati'] },
    before, after, elapsedSeconds: 30, trace: [{ seconds: 30, x: 810, y: 0, z: 0, current: 'nalati', gameplayReady: true }] };
}

test('witness uses the served lattice and still refuses wrong interiors and changed pitch', () => {
  const valid = witness();
  expect(gridFloorWitnessFailures(valid)).toEqual([]);
  const outside = witness(); outside.after.live.live.worldFeet.x = 813;
  expect(gridFloorWitnessFailures(outside)).toContain('Destination feet are outside its interior');
  const changed = witness(); changed.after.pitch = 555;
  expect(gridFloorWitnessFailures(changed)).toContain('Grid lattice changed during the route');
  const invalid = witness(); invalid.after.pitch = Number.NaN;
  expect(gridFloorWitnessFailures(invalid)).toContain('Grid lattice changed during the route');
});

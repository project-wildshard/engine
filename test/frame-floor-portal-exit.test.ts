import { expect, test } from 'vitest';
import { floorGridPortalPlan, type FloorGridPlan } from '../scripts/frame-floor-grid.mjs';

const cell = { instance: 'tower', slug: 'tower', cell: [1, -1] as const };
const plan: FloorGridPlan = { name: 'tower-road', from: 'tower', to: null,
  waypoints: [{ x: 555, z: -277.5 }, { x: 277.5, z: -277.5 }], requiredResidents: [] };
const portal = { road: { id: 'road', at: [0, 0, 236] }, destination: { id: 'arrival', at: [0, 125, 20] },
  exit: { id: 'exit', at: [20, 125, 50] }, route: [[0, 125, 20], [20, 125, 20], [20, 125, 50]],
  links: [{ from: 'road', to: 'arrival' }, { from: 'exit', to: 'road' }] };

test('leaves elevated cells through the declared walk and outgoing link', () => {
  const result = floorGridPortalPlan(plan, cell, [{ edge: 'north', kind: 'portalLink', portal }]);
  expect(result.waypoints).toEqual([{ x: 555, z: -535 }, { x: 575, z: -535 }, { x: 575, z: -505 },
    { id: 'exit', x: 575, y: 125, z: -505 }, { id: 'road', x: 555, y: 0, z: -319 }, ...plan.waypoints]);
  expect(result.portal).toMatchObject({ reverse: true, road: { id: 'road' }, destination: { id: 'exit' } });
  expect(result.start).toBeUndefined();
});

test('does not invent the reverse of an incoming-only link', () => {
  expect(() => floorGridPortalPlan(plan, cell, [{ edge: 'north', kind: 'portalLink', portal: { ...portal,
    links: [{ from: 'road', to: 'arrival' }] } }])).toThrow('Missing declared floor portal exit link');
});

import { expect, test } from 'vitest';
import { PHONE_NEAR_CELLS, farDrawnAt, farNearReachOn, nearReach, planNearPlaceholders } from './nearPlaceholderPlan';

const pitch = 555, cells = [-2, -1, 0, 1, 2].flatMap(x => [-2, -1, 0, 1, 2].map(z => ({ instance: `c${x}${z}`, slug: 'content', cell: [x, z] as [number, number], origin: { x: x * pitch, y: 0, z: z * pitch } })));

test('every cell but the entered one is near without a limit (desktop D)', () => {
  expect(planNearPlaceholders(cells, pitch, { x: 0, z: 0 }, 'c00').cells).toHaveLength(24);
});

test('the phone budget keeps only the nearest cells near, nearest first, held cells winning a near tie', () => {
  const plan = planNearPlaceholders(cells, pitch, { x: 277.5, z: 0 }, 'c00', { limit: PHONE_NEAR_CELLS });
  expect(plan.cells).toHaveLength(PHONE_NEAR_CELLS); expect(plan.cells[0]?.instance).toBe('c10');
  expect(plan.cells.every(cell => cell.distance < pitch)).toBe(true);
  const held = planNearPlaceholders(cells, pitch, { x: 277.5, z: 0 }, 'c00', { limit: PHONE_NEAR_CELLS, held: new Set(['c11']) });
  expect(held.cells).toHaveLength(PHONE_NEAR_CELLS); expect(held.cells.map(cell => cell.instance)).toContain('c11');
  expect(planNearPlaceholders(cells, pitch, { x: 0, z: 0 }, null, { limit: 0 }).cells).toEqual([]);
  expect(() => planNearPlaceholders(cells, pitch, { x: 0, z: 0 }, null, { limit: -1 })).toThrow('limit');
});

test('J500 rule 3: a cell within one road cell of the eye stays near past the phone limit, and its far proxy never draws there', () => {
  const reach = nearReach(pitch), crossing = { x: pitch / 2, z: pitch / 2 };
  // at a road crossing four cells meet; with a limit of one, the other three would fall back to their far proxies
  const plan = planNearPlaceholders(cells, pitch, crossing, null, { limit: 1, reach });
  expect(plan.cells.map(cell => cell.instance).sort()).toEqual(['c00', 'c01', 'c10', 'c11']);
  expect(planNearPlaceholders(cells, pitch, crossing, null, { limit: 1 }).cells).toHaveLength(1);
  // the road between two cells is one road cell wide; its diagonal at a crossing is the reach
  expect(farDrawnAt(0, pitch)).toBe(false);
  expect(farDrawnAt(pitch - 512, pitch)).toBe(false);
  expect(farDrawnAt(reach + 1, pitch)).toBe(true);
  expect(farDrawnAt(pitch, pitch)).toBe(true);
});

test('J500 rule 3 is on with rule 2: off only when debug.farNearReach is false', () => {
  expect(farNearReachOn(null)).toBe(true);
  expect(farNearReachOn(false)).toBe(false);
  expect(farNearReachOn(true)).toBe(true);
});

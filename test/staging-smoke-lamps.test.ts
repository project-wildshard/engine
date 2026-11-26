import { expect, test } from 'vitest';
import { darkLampsProblem } from '../src/scripts/staging-smoke/scenarios.mjs';

// QA 11-25 row 138: staging's grid page drew none of Brasscap Mesa's 8 declared look lamps and no train check saw it. K6 now
// reads the entered cell's grid readout and names a zone whose declared lamps light none.
const row = (instance: string, lampsDeclared: number, lampsLit: number) => ({ instance, layers: 0, swings: 0, water: 0, splash: false, live: true, lampsDeclared, lamps: Math.min(lampsDeclared, 5), lampsLit });

test('a zone whose declared lamps light none is a K6 problem; one that lights them, or declares none, is not', () => {
  expect(darkLampsProblem({ inside: 'blender-template', sceneLife: [row('blender-template', 8, 0)] })).toBe('look lamps dark: blender-template declares 8 lamps and lights none (QA 11-25 row 138)');
  expect(darkLampsProblem({ inside: 'blender-template', sceneLife: [row('blender-template', 8, 5)] })).toBeNull();
  expect(darkLampsProblem({ inside: 'driftwood-isle', sceneLife: [row('blender-template', 8, 0)] })).toBeNull();
  expect(darkLampsProblem({ inside: 'pine-hollow', sceneLife: [row('pine-hollow', 0, 0)] })).toBeNull();
  expect(darkLampsProblem(null)).toBeNull();
  expect(darkLampsProblem({ inside: 'mossgate' })).toBeNull();
});

// QA 11-25 row 154: Mossgate and Glowfen declare lamps but have no Shard Select card; K6 enters them by the tap after the cards
test('K6 enters the lamp zones that have no card by the tap, past its card budget, and checks their lamps', async () => {
  const { LAMP_TAP_ZONES } = await import('../src/scripts/staging-smoke/scenarios.mjs');
  expect(LAMP_TAP_ZONES).toEqual(['mossgate', 'glowfen']);
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/scripts/staging-smoke/scenarios.mjs', import.meta.url), 'utf8');
  const loop = source.slice(source.indexOf('for (const zone of LAMP_TAP_ZONES)'));
  expect(loop.slice(0, 1600)).toMatch(/enterZone\(page, \{ zone, base: url/u);
  expect(loop.slice(0, 1600)).toMatch(/darkLampsProblem\(grid\)/u);
  expect(loop.slice(0, 1600)).not.toMatch(/K6_BUDGET_MS/u);
});

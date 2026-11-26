import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DESKTOP_TIER_DPR, drawingRatio } from '../scripts/fps/measure.mjs';
import { fpsPlan } from '../scripts/fps/plan.mjs';

// DRIFTWOOD-FPS DF14 (mini-dwfps): the desktop profiles draw at the render scale a desktop player gets
test('the bench pins the desktop tier render scale the engine ships', () => {
  const tiers = readFileSync(resolve(import.meta.dirname, '../../src/client/engine/render/tiers.ts'), 'utf8');
  const desktop = /\n  desktop: \{\n\s*maxTexture: \d+, layerSize: \d+, dpr: ([\d.]+),/u.exec(tiers);
  expect(desktop?.[1]).toBe(String(DESKTOP_TIER_DPR));
});

test('each profile names the drawing buffer ratio it must witness', () => {
  const { profiles } = fpsPlan({ qualify: true, runs: '3' });
  const ratios = Object.fromEntries(Object.entries(profiles).map(([name, specs]) =>
    [name, specs.map(spec => drawingRatio({ ...spec, cpu: 1, floor: 120 }))]));
  expect(ratios).toEqual({
    'phone-lpm-low': [1], 'phone-high': [2], 'phone-low': [1],
    // 1496 × 717 on a 2× screen draws at 1.5; 1920 × 1080 on a 1× screen at 1
    'desktop-medium': [1.5, 1],
    // desktop Low is the phone preset drawn uncapped at the raster it names
    'desktop-native': [1.5, 2, 1, 1],
  });
});

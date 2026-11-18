import { expect, test } from 'vitest';
import { tierUrl } from './bytes';
import { registerGpuFiles } from './gpuFiles';

// SHARD-SOURCE S12f1b: Pine's glTF prop recipes name their 1k UASTC maps themselves. A phone row keyed by such a map (the
// cook moves its target to the 6×6 file) is what three's KTX2 read fetches instead, however three resolved the URL.
const MAP = '/assets/gpu/models/hatchet/textures/hatchet_diff_1k-961e709c.ktx2';
const COOKED = '/assets/gpu/models/hatchet/textures/hatchet_diff_1k-961e709c.t512-0123abcd.ktx2';
registerGpuFiles({ phone: { [MAP]: COOKED }, desktop: { [MAP]: COOKED } });

test('a KTX2 a model names reads its keyed row in KTX2 mode, from a path, an absolute URL or a dotted path', () => {
  expect(tierUrl(MAP, 'ktx2')).toBe(COOKED);
  expect(tierUrl(new URL(MAP, location.href).href, 'ktx2')).toBe(COOKED);
  expect(tierUrl('/assets/models/hatchet/../../gpu/models/hatchet/textures/hatchet_diff_1k-961e709c.ktx2', 'ktx2')).toBe(COOKED);
});

test('images mode, an unkeyed KTX2, a query and another origin keep the URL', () => {
  expect(tierUrl(MAP, 'img')).toBe(MAP);
  const other = '/assets/gpu/models/hatchet/textures/hatchet_arm_1k-35decd3b.ktx2';
  expect(tierUrl(other, 'ktx2')).toBe(other);
  expect(tierUrl(`${MAP}?v=1`, 'ktx2')).toBe(`${MAP}?v=1`);
  expect(tierUrl(`https://elsewhere.invalid${MAP}`, 'ktx2')).toBe(`https://elsewhere.invalid${MAP}`);
});

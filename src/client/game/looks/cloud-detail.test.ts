import { describe, expect, it } from 'vitest';
import { cloudDetail, cumulusGeometry } from './toonSky';

describe('the cumulus detail at phone Low (DRIFTWOOD-FPS DF9)', () => {
  it('drops to one step at phone Low and keeps the row elsewhere', () => {
    expect(cloudDetail(2, true)).toBe(1);
    expect(cloudDetail(2, false)).toBe(2);
    expect(cloudDetail(0, true)).toBe(0);
    expect(cloudDetail(undefined, false)).toBe(1);
  });
  it('a one-step puff is 80 triangles against 180', () => {
    const row = [[0, 0, 0, 1, 0, 0, 0]];
    expect(cumulusGeometry(row, 1).getAttribute('position').count / 3).toBe(80);
    expect(cumulusGeometry(row, 2).getAttribute('position').count / 3).toBe(180);
  });
});

import { expect, test } from 'vitest';
import { TrampleField, TrampleTrail } from '@wildshard/engine/game/systems/looks/trampleField';

test.each([['steppe', .55, 30], ['orchard', .9, 5]] as const)('%s trail rows restore a native continuation exactly', (_name, radius, speedLimit) => {
  const map = new TrampleField(), trail = new TrampleTrail(map, speedLimit);
  const advance = (owner: TrampleTrail, field: TrampleField, x: number, dt: number): void => {
    const at = { x, z: .25 }; owner.push(dt, at, radius); field.update(dt, at);
  };
  expect(trail.snapshot().trail).toBe(null);
  advance(trail, map, .25, .05); advance(trail, map, .35, .05); advance(trail, map, .45, .05);
  const saved = trail.snapshot(), secondMap = new TrampleField(), restored = new TrampleTrail(secondMap, speedLimit);
  restored.restore(saved);
  expect(restored.snapshot()).toEqual(saved);
  for (const [x, dt] of [[.55, .05], [20.25, .05], [20.35, .05], [20.45, 0], [20.55, .05]]) {
    if (x === undefined || dt === undefined) throw new Error('Missing trail sample');
    advance(trail, map, x, dt); advance(restored, secondMap, x, dt);
    expect(restored.snapshot()).toEqual(trail.snapshot());
  }
  expect(saved.trail).toEqual([.45, .25]);
});

test('speed rows skip teleports but retain the next stride origin', () => {
  const slowMap = new TrampleField(), fastMap = new TrampleField();
  const slow = new TrampleTrail(slowMap, 5), fast = new TrampleTrail(fastMap, 30);
  for (const [trail, map] of [[slow, slowMap], [fast, fastMap]] as const) {
    const start = { x: .25, z: .25 }, end = { x: 1.25, z: .25 };
    map.update(0, start); trail.push(.1, start, .55); map.update(.1, start);
    trail.push(.1, end, .55); map.update(.1, end);
  }
  expect(slowMap.amountAt(1.25, .25)).toBe(0);
  expect(fastMap.amountAt(1.25, .25)).toBeGreaterThan(.9);
  slow.push(.1, { x: 1.35, z: .25 }, .55); slowMap.update(.1, { x: 1.35, z: .25 });
  expect(slowMap.amountAt(1.25, .25)).toBeGreaterThan(.8);
});

test('malformed map restoration changes neither the trail nor the field', () => {
  const map = new TrampleField(), trail = new TrampleTrail(map, 30), at = { x: .25, z: .25 };
  map.update(0, at); trail.push(.05, at, .55); map.update(.05, at);
  const before = trail.snapshot();
  expect(() => { trail.restore({ trail: [100, 100], map: { ...before.map, cells: [0, 2, 0] } }); }).toThrow('Invalid trample cell');
  expect(trail.snapshot()).toEqual(before);
  expect(() => new TrampleTrail(map, 0)).toThrow('Invalid trail speed limit');
});

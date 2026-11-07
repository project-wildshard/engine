import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { cullPlanSteps, ROAD_LOD, type CullPlan } from './roadCull';

function geometry(wide: boolean): BufferGeometry {
  const points: number[] = [], grain: number[] = [], indices: number[] = [];
  for (let z = 0; z <= 20; z++) for (let x = 0; x <= 20; x++) {
    points.push((x - 10) * 12.5, ((x - z) % 3) / 8, (z - 10) * 12.5);
    grain.push(x / 3, z / 7, (x + z) % 3, x % 2);
    if (x < 20 && z < 20) { const n = z * 21 + x; indices.push(n, n + 1, n + 21, n + 1, n + 22, n + 21); }
  }
  return new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(points), 3))
    .setAttribute('grainUv', new BufferAttribute(Float32Array.from(grain), 4))
    .setIndex(new BufferAttribute(wide ? Uint32Array.from(indices) : Uint16Array.from(indices), 1));
}
function fallback(source: BufferGeometry, delta = 0): void {
  const position = source.getAttribute('position');
  position.getX = function getX(index: number): number { return BufferAttribute.prototype.getX.call(this, index) + delta; };
}
function plan(source: BufferGeometry, tileSize: number | undefined, change?: (turn: number) => void): { result: CullPlan; turns: number } {
  const steps = cullPlanSteps(source, 500, ROAD_LOD, tileSize); let turns = 0;
  for (;;) { const row = steps.next(); if (row.done === true) return { result: row.value, turns }; change?.(++turns); }
}

test.each([false, true].flatMap(wide => [undefined, 62.5].map(tileSize => ({ wide, tileSize }))))(
  'raw road words retain complete bin/LOD source and spheres ($wide, $tileSize)', ({ wide, tileSize }) => {
    const actual = geometry(wide), expected = actual.clone(); fallback(expected);
    try { expect(plan(actual, tileSize)).toEqual(plan(expected, tileSize)); }
    finally { actual.dispose(); expected.dispose(); }
  });

test.each(['array', 'reader'] as const)('road raw readers refresh after each original pacing yield (%s)', mode => {
  const actual = geometry(false), expected = actual.clone(); fallback(expected);
  const change = (source: BufferGeometry) => (turn: number): void => {
    if (turn !== 2) return;
    const position = source.getAttribute('position');
    if (mode === 'reader') fallback(source, 63.25);
    else {
      if (!(position instanceof BufferAttribute)) throw new Error('Missing plain road positions');
      const next = Float32Array.from(position.array); for (let i = 0; i < next.length; i += 3) next[i] = (next[i] ?? 0) + 63.25;
      position.array = next;
    }
  };
  try { expect(plan(actual, 62.5, change(actual))).toEqual(plan(expected, 62.5, change(expected))); }
  finally { actual.dispose(); expected.dispose(); }
});

test('custom grain accessors retain their reads and mutations before the next vertex', () => {
  const actual = geometry(false), expected = actual.clone(); fallback(expected);
  const changed = (source: BufferGeometry): (() => number) => {
    const grain = source.getAttribute('grainUv'), position = source.getAttribute('position'); let calls = 0;
    grain.getZ = function getZ(index: number): number {
      if (++calls === 1) {
        if (!(position instanceof BufferAttribute)) throw new Error('Missing plain road positions');
        const next = Float32Array.from(position.array); for (let i = 0; i < next.length; i += 3) next[i] = (next[i] ?? 0) + .25;
        position.array = next;
      }
      return BufferAttribute.prototype.getZ.call(this, index);
    };
    return () => calls;
  };
  const actualCalls = changed(actual), expectedCalls = changed(expected);
  try { expect(plan(actual, 62.5)).toEqual(plan(expected, 62.5)); expect(actualCalls()).toBe(expectedCalls()); expect(actualCalls()).toBeGreaterThan(0); }
  finally { actual.dispose(); expected.dispose(); }
});

test('normalized attributes retain their complete accessor plan', () => {
  const actual = geometry(false), expected = actual.clone(); actual.getAttribute('position').normalized = true; expected.getAttribute('position').normalized = true;
  fallback(expected);
  try { expect(plan(actual, 62.5)).toEqual(plan(expected, 62.5)); }
  finally { actual.dispose(); expected.dispose(); }
});

import { expect, test, vi } from 'vitest';
import { declaredWaterBody, dryEntryContains, setLiveWaterLevel, type DryEntryEdge } from './declared';
import { CHUNK_HALF } from '../../core/config';
import * as polygon from '../yawFrame';

test('stream queries retain exact interpolation, tie order and live levels', () => {
  const name = 'test/fc11-stream';
  const input = { id: name, kind: 'stream' as const, width: 4, levels: { [name]: 4 }, points: [
    { x: 0, z: 0, level: 0, under: name }, { x: 10, z: 0, level: 10 },
    { x: 10, z: 0, level: 99 }, { x: 20, z: 0, level: 20 },
  ] };
  const body = declaredWaterBody(input);
  expect([body.restAt(0, 0), body.restAt(5, 1), body.restAt(10, 0), body.restAt(15, 0)]).toEqual([4, 7, 10, 59.5]);
  expect(body.restAt(5, 2)).toBeNull();
  setLiveWaterLevel(name, 8);
  expect(body.restAt(5, 1)).toBe(9);
  input.points[0] = { x: 100, z: 100, level: 100 };
  expect(body.restAt(5, 1)).toBe(9);
  expect(body.inside(5, 1, 8)).toBe(true); expect(body.inside(5, 1, 9)).toBe(false);
});

test('FC16: a bent stream answers as its nearest segment within half its width, across a sweep', () => {
  const points = [{ x: -40, z: -30, level: 1 }, { x: -10, z: -28, level: 2 }, { x: 0, z: 5, level: 3 }, { x: 25, z: 9, level: 1.5 }, { x: 30, z: 40, level: 4 }];
  const width = 6, body = declaredWaterBody({ id: 'test/fc16-bent', kind: 'stream', width, points });
  // the plain scan the box skip stands in for: every segment measured, the first nearest kept
  const reference = (x: number, z: number): number | null => {
    let distance = Infinity, height = 1;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]; if (a === undefined || b === undefined) continue;
      const dx = b.x - a.x, dz = b.z - a.z, n = dx * dx + dz * dz, t = n === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / n));
      const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
      if (d < distance) { distance = d; height = a.level + (b.level - a.level) * t; }
    }
    return distance < width / 2 ? height : null;
  };
  let wet = 0;
  for (let x = -50; x <= 40; x += 0.75) for (let z = -40; z <= 50; z += 0.75) {
    const got = body.restAt(x, z); expect(got).toBe(reference(x, z)); if (got !== null) wet++;
  }
  expect(wet).toBeGreaterThan(500);
});

test('query bounds, invalid numbers and circle edges retain their original decisions', () => {
  const body = declaredWaterBody({ id: 'circle', kind: 'pool', level: -0, shape: { kind: 'circle', x: 0, z: 0, radius: 250 } });
  expect(Object.is(body.restAt(0, 0), -0)).toBe(true);
  expect(body.restAt(249, 0)).toBe(-0); expect(body.restAt(250, 0)).toBeNull();
  for (const bad of [Number.NaN, Infinity, -Infinity]) {
    expect(body.restAt(bad, 0)).toBeNull(); expect(body.restAt(0, bad)).toBeNull();
    expect(Object.is(body.surfaceAt(bad, 0), -0)).toBe(true);
    expect(Object.is(body.surfaceAt(0, bad), -0)).toBe(true);
  }
  expect(body.restAt(251, 0)).toBeNull(); expect(body.inside(0, 0, Number.NaN)).toBe(false);
});

test('dry sockets retain ordered exclusions and skip sparse declaration holes', () => {
  const edges: DryEntryEdge[] = ['north', 'east', 'south', 'west'];
  const body = declaredWaterBody({ id: 'pool', kind: 'pool', level: 2,
    shape: { kind: 'circle', x: 0, z: 0, radius: 1000 }, dryEntries: edges });
  for (const [x, z] of [[0, CHUNK_HALF], [CHUNK_HALF, 0], [0, -CHUNK_HALF], [-CHUNK_HALF, 0], [0, 0]]) {
    if (x === undefined || z === undefined) throw new Error('Missing test point');
    expect(body.restAt(x, z)).toBe(edges.some(edge => dryEntryContains(edge, x, z)) ? null : 2);
  }
  const sparse: DryEntryEdge[] = []; sparse[2] = 'north';
  const other = declaredWaterBody({ id: 'sparse', kind: 'pool', level: 3,
    shape: { kind: 'circle', x: 0, z: 0, radius: 1000 }, dryEntries: sparse });
  expect(other.restAt(0, CHUNK_HALF)).toBeNull(); expect(other.restAt(0, 0)).toBe(3);
});

test('polygon Z bands skip dry scans while preserving the native concave edge decisions', () => {
  const points: [number, number][] = [[-8, 12], [9, 12], [9, 30], [3, 22], [-8, 30]];
  const original = polygon.insidePolygon, body = declaredWaterBody({ id: 'bounded-pool', kind: 'pool', level: -2,
    shape: { kind: 'polygon', points } });
  const query = vi.spyOn(polygon, 'insidePolygon');
  try {
    expect(body.restAt(0, 0)).toBeNull(); expect(body.restAt(0, 40)).toBeNull();
    expect(query).not.toHaveBeenCalled();
    for (let x = -10; x <= 11; x += .25) for (let z = 10; z <= 32; z += .25) {
      expect(body.restAt(x, z)).toBe(original(points, x, z) ? -2 : null);
    }
    expect(query).toHaveBeenCalled();
    points[0] = [0, 0]; // The compiled declaration retains its owned geometry.
    expect(body.restAt(0, 0)).toBeNull();
  } finally { query.mockRestore(); }
});

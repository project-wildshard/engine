import { expect, test, vi } from 'vitest';
import { readColliderRows } from './colliders';

test('reused collider grammar follows changed policy values and still returns owned rows', () => {
  const surfaces: ('rock' | 'wood')[] = ['rock'];
  const policy = { kinds: ['box'] as const, surfaces, requireSurface: true };
  const box = { kind: 'box', x: 0, y: 0, z: 0, hx: 1, hy: 2, hz: 3, surface: 'rock' };
  const first = readColliderRows([box], policy), second = readColliderRows([box], policy);
  expect(second).toEqual(first); expect(second[0]).not.toBe(first[0]);
  surfaces[0] = 'wood';
  expect(() => readColliderRows([box], policy)).toThrow('Unexpected collider surface');
  expect(readColliderRows([{ ...box, surface: 'wood' }], policy)).toHaveLength(1);
  expect(() => readColliderRows([{ ...box, surface: 'wood', hx: Number.NaN }], policy)).toThrow();
  expect(() => readColliderRows([{ ...box, kind: 'ball', radius: 1 }], policy)).toThrow('Unexpected collider shape');
});

test('collider rows retain primitive values, own nested lanes and enforce caller admission', () => {
  const box = { kind: 'box', x: 1, y: 2, z: 3, hx: 4, hy: 5, hz: 6, rot: { x: 0, y: 0.1, z: 0, w: 0.9 }, surface: 'rock' };
  const stairs = { kind: 'treads', from: { x: 1, y: 2, z: 3 }, to: { x: 4, y: 5, z: 6 }, width: 2, count: 4, surface: 'rock' };
  const policy = { kinds: ['box', 'capsule', 'ball', 'hull', 'trimesh', 'treads'], surfaces: ['rock'], requireSurface: true } as const;
  const points = [0, 0, 0, 1, 0, 0, 0, 1, 0], indices = [0, 1, 2], at = { x: 1, y: 2, z: 3, surface: 'rock' };
  const rows = readColliderRows([box, stairs, { kind: 'hull', ...at, points }, { kind: 'trimesh', ...at, vertices: points, indices },
    { kind: 'capsule', ...at, radius: 0.4, halfHeight: 1 }, { kind: 'ball', ...at, radius: 0.4 }], policy);
  expect(rows.slice(0, 2)).toEqual([box, stairs]);
  const [a, b, hull, mesh] = rows;
  if (a?.kind !== 'box' || b?.kind !== 'treads' || hull?.kind !== 'hull' || mesh?.kind !== 'trimesh' || a.rot === undefined) throw new Error('Fixture shapes changed');
  a.rot.x = 0.5; b.from.y = 10; hull.points[0] = 10; mesh.indices[0] = 2;
  expect(box.rot.x).toBe(0); expect(stairs.from.y).toBe(2); expect(points[0]).toBe(0); expect(indices[0]).toBe(0);
  expect(mesh.vertices).toBeInstanceOf(Float32Array);
  expect(mesh.indices).toBeInstanceOf(Uint32Array);
  expect(() => readColliderRows([{ ...box, extra: true }], policy)).toThrow();
  expect(() => readColliderRows([{ ...box, surface: undefined }], policy)).toThrow('surface');
  expect(() => readColliderRows([{ ...box, x: Number.POSITIVE_INFINITY }], policy)).toThrow('finite');
  expect(() => readColliderRows([stairs], { kinds: ['box'], surfaces: ['rock'] })).toThrow('shape');
  expect(() => readColliderRows([{ kind: 'trimesh', ...at, vertices: points, indices: [0, -1, 2] }], policy)).toThrow();
});

test('dense collider lanes convert directly to owned storage without a JS array clone', () => {
  const points = Object.freeze([0, 0, 0, 1, 0, 0, 0, 1, 0]), at = { x: 0, y: 0, z: 0 };
  const policy = { kinds: ['hull', 'trimesh'], surfaces: [] } as const;
  const [hull] = readColliderRows([{ kind: 'hull', ...at, points }], policy);
  if (hull?.kind !== 'hull') throw new Error('Missing hull');
  expect(hull.points).toEqual(new Float32Array(points));
  hull.points[0] = 2; expect(points[0]).toBe(0);
  const sparse = [0, 0, 0]; Reflect.deleteProperty(sparse, '1');
  for (const invalid of [[0, Number.NaN, 0], [0, Number.POSITIVE_INFINITY, 0], [0, undefined, 0], sparse]) {
    expect(() => readColliderRows([{ kind: 'hull', ...at, points: invalid }], policy)).toThrow();
  }
  for (const indices of [[0, .5, 2], [0, -1, 2], [0, 0x1_0000_0000, 2]]) {
    expect(() => readColliderRows([{ kind: 'trimesh', ...at, vertices: points, indices }], policy)).toThrow();
  }
});

test('validates the exact values copied from changing lane accessors', () => {
  const points = [0, 0, 0], indices = [0, 0, 0], at = { x: 0, y: 0, z: 0 };
  const readPoint = vi.fn().mockReturnValueOnce(1.25).mockReturnValue(Number.NaN);
  const readIndex = vi.fn().mockReturnValueOnce(2).mockReturnValue(1.5);
  Object.defineProperty(points, '0', { get: readPoint });
  Object.defineProperty(indices, '0', { get: readIndex });
  const [hull, mesh] = readColliderRows([{ kind: 'hull', ...at, points }, { kind: 'trimesh', ...at, vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices }], { kinds: ['hull', 'trimesh'], surfaces: [] });
  if (hull?.kind !== 'hull' || mesh?.kind !== 'trimesh') throw new Error('Missing collider shapes');
  expect(hull.points[0]).toBe(1.25); expect(mesh.indices[0]).toBe(2);
  expect(readPoint).toHaveBeenCalledOnce(); expect(readIndex).toHaveBeenCalledOnce();
});

test('copies bounded indexed facts instead of custom array iterators', () => {
  const points = [1, 2, 3], indices = [0, 0, 0], at = { x: 0, y: 0, z: 0 };
  const iterator = vi.fn(function* untrustedValues() { yield Number.NaN; yield 99; yield 99; yield 99; });
  Object.defineProperty(points, Symbol.iterator, { value: iterator });
  Object.defineProperty(indices, Symbol.iterator, { value: iterator });
  const [hull, mesh] = readColliderRows([{ kind: 'hull', ...at, points }, { kind: 'trimesh', ...at, vertices: [0, 0, 0], indices }], { kinds: ['hull', 'trimesh'], surfaces: [] });
  if (hull?.kind !== 'hull' || mesh?.kind !== 'trimesh') throw new Error('Missing collider shapes');
  expect(hull.points).toEqual(new Float32Array([1, 2, 3]));
  expect(mesh.indices).toEqual(new Uint32Array([0, 0, 0]));
  expect(iterator).not.toHaveBeenCalled();
});


test('collision-free copies allocate no shape grammar or policy reads', () => {
  const surfaces = vi.fn(() => ['rock'] as const), kinds = vi.fn(() => ['box'] as const);
  const policy = { get surfaces() { return surfaces(); }, get kinds() { return kinds(); } };
  const a = readColliderRows([], policy), b = readColliderRows([], policy);
  expect(a).toEqual([]); expect(b).toEqual([]); expect(a).not.toBe(b);
  expect(surfaces).not.toHaveBeenCalled(); expect(kinds).not.toHaveBeenCalled();
  expect(readColliderRows([{ kind: 'box', x: 0, y: 0, z: 0, hx: 1, hy: 1, hz: 1, surface: 'rock' }], policy)).toHaveLength(1);
  expect(surfaces).toHaveBeenCalled(); expect(kinds).toHaveBeenCalled();
});

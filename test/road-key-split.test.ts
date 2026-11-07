import { BufferAttribute, BufferGeometry } from 'three';
import { expect, test, vi } from 'vitest';
import { splitByKey } from '../src/client/game/grid/roadSolid';

/** Retained pre-cut Map oracle: complete storage, ordering and fallback values. */
function original(geometry: BufferGeometry, keyOf: (triangle: number) => number, keys: number): ReturnType<typeof splitByKey> {
  const index = geometry.getIndex(); if (index === null) throw new Error('Missing index');
  const attr = (name: string): BufferAttribute | undefined => { const a = geometry.hasAttribute(name) ? geometry.getAttribute(name) : undefined; return a instanceof BufferAttribute ? a : undefined; };
  const pos = attr('position'), nor = attr('normal'), col = attr('color'), uv = attr('uv');
  const parts: { map: Map<number, number>; source: number[]; indices: number[] }[] = Array.from({ length: keys }, () => ({ map: new Map(), source: [], indices: [] }));
  for (let t = 0; t < index.count / 3; t++) {
    const part = parts[keyOf(t)]; if (part === undefined) continue;
    for (let c = 0; c < 3; c++) {
      const n = index.getX(t * 3 + c); let local = part.map.get(n);
      if (local === undefined) { local = part.source.length; part.map.set(n, local); part.source.push(n); }
      part.indices.push(local);
    }
  }
  return parts.map(({ source, indices }) => {
    const pick = (a: BufferAttribute | undefined, size: number, fallback: number): Float32Array => {
      const out = new Float32Array(source.length * size);
      source.forEach((n, k) => { for (let c = 0; c < size; c++) out[k * size + c] = a === undefined ? fallback : a.array[n * size + c] ?? fallback; });
      return out;
    };
    return { positions: pick(pos, 3, 0), normals: pick(nor, 3, 0), colours: pick(col, 3, 1), uvs: pick(uv, 2, 0), indices: Uint32Array.from(indices), source: Uint32Array.from(source) };
  });
}
function fixture(odd: boolean, optional: boolean): BufferGeometry {
  const count = 257, geometry = new BufferGeometry(), positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colours = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
  for (let n = 0; n < count; n++) {
    positions[n * 3] = n % 7 === 0 ? -0 : n / 17; positions[n * 3 + 1] = n % 19; positions[n * 3 + 2] = -n / 13;
    normals[n * 3] = 0.5; normals[n * 3 + 1] = -0.25; normals[n * 3 + 2] = 1;
    colours[n * 3] = n / 257; colours[n * 3 + 1] = n % 11 === 0 ? -0 : 0.5; colours[n * 3 + 2] = 0.125;
    uvs[n * 2] = n / 7; uvs[n * 2 + 1] = -n / 11;
  }
  const numbers = Array.from({ length: count * 9 }, (_, i) => (Math.floor(i / 3) + (i % 3) * 7) % count);
  if (odd) { numbers[1200] = Number.NaN; numbers[1201] = Number.POSITIVE_INFINITY; numbers[1210] = Number.NaN; numbers[1300] = -1; numbers[1400] = 3.5; numbers[1401] = 3.5; numbers[1500] = 9999; }
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  if (optional) geometry.setAttribute('normal', new BufferAttribute(normals, 3)).setAttribute('color', new BufferAttribute(colours, 3)).setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(odd ? Float32Array.from(numbers) : Uint32Array.from(numbers), 1));
  return geometry;
}
function same(actual: ReturnType<typeof splitByKey>, expected: ReturnType<typeof splitByKey>): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, part] of expected.entries()) {
    const copy = actual[index]; if (copy === undefined) throw new Error('Missing material part');
    for (const field of ['positions', 'normals', 'colours', 'uvs', 'indices', 'source'] as const) {
      const a = part[field], b = copy[field];
      expect(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)).toEqual(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    }
  }
}
test.each([false, true].flatMap(odd => [false, true].map(optional => ({ odd, optional }))))(
  'dense/sparse material grouping keeps every original word ($odd, channels $optional)', ({ odd, optional }) => {
    const geometry = fixture(odd, optional), key = (triangle: number): number => triangle % 11 === 0 ? 99 : triangle % 3;
    try { same(splitByKey(geometry, key, 6), original(geometry, key, 6)); }
    finally { geometry.dispose(); }
  });
test('custom index readers and count accessors retain their original calls and storage', () => {
  const geometry = fixture(false, true), index = geometry.getIndex(), position = geometry.getAttribute('position');
  if (index === null) throw new Error('Missing custom index');
  const getX = index.getX.bind(index), read = vi.fn((i: number) => getX(i) + (i % 7 === 0 ? 0.25 : 0));
  Object.defineProperty(index, 'getX', { value: read });
  Object.defineProperty(position, 'count', { get: () => { throw new Error('The original grouping never reads custom position count'); } });
  const key = (triangle: number): number => triangle % 3;
  try {
    const expected = original(geometry, key, 6), calls = read.mock.calls.length; read.mockClear();
    same(splitByKey(geometry, key, 6), expected); expect(read).toHaveBeenCalledTimes(calls);
  } finally { geometry.dispose(); }
});

test.each([4000, 20000])('unused position capacity keeps original sparse/dense storage (%s vertices)', count => {
  const geometry = fixture(false, true), originalPositions = geometry.getAttribute('position'), padded = new Float32Array(count * 3);
  padded.set(originalPositions.array); geometry.setAttribute('position', new BufferAttribute(padded, 3));
  const key = (triangle: number): number => triangle % 3;
  try { same(splitByKey(geometry, key, 6), original(geometry, key, 6)); }
  finally { geometry.dispose(); }
});

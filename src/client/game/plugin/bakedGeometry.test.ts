import { expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Float16BufferAttribute } from 'three';
import { readBakedGeometry, type BakedGeometryRow, type BakedType } from './geometry';

test('baked reads exhaust packed bounds and preserve native boxes, spheres and detached positions', () => {
  const large = new Float32Array(65538 * 3);
  for (let i = 0; i < large.length; i++) large[i] = Math.sin(i * 1.7) * (i % 179 - 90);
  const cases: readonly (readonly [BakedType, BufferAttribute])[] = [
    ['f32', new BufferAttribute(large, 3)],
    ['f32', new BufferAttribute(new Float32Array([-0, 0, -0, 0, -0, 0]), 3)],
    ['f32', new BufferAttribute(new Float32Array(), 3)],
    ['i8', new BufferAttribute(new Int8Array([-128, 0, 127, 17, -19, 4]), 3, true)],
    ['f16', new Float16BufferAttribute(new Uint16Array([0xbc00, 0, 0x3c00, 0x4000, 0x4200, 0x4400]), 3)],
  ];
  for (const [type, position] of cases) for (const box of [false, true]) {
    const source = new Uint8Array(position.array.buffer, position.array.byteOffset, position.array.byteLength);
    const bytes = new Uint8Array(source.length + 3); bytes.set(source, 3);
    const row: BakedGeometryRow = { attrs: [['position', type, 3, position.normalized]], count: position.count,
      index: null, indexCount: 0, box };
    const oracle = new BufferGeometry().setAttribute('position', position);
    oracle.computeBoundingSphere(); if (box) oracle.computeBoundingBox();
    const decoded = readBakedGeometry(bytes, 3, row);
    try {
      expect(decoded.boundingSphere).toEqual(oracle.boundingSphere);
      expect(decoded.boundingBox).toEqual(oracle.boundingBox);
      const actual = decoded.getAttribute('position');
      expect(actual).toBeInstanceOf(position.constructor);
      expect(actual.itemSize).toBe(3); expect(actual.normalized).toBe(position.normalized);
      expect(actual.array).toEqual(position.array);
      expect(actual.array.buffer).not.toBe(bytes.buffer);
      bytes.fill(0); expect(actual.array).toEqual(position.array);
    } finally { decoded.dispose(); oracle.dispose(); }
  }
});

test('baked bounds leave every decoded attribute and delta index intact', () => {
  const positions = new Float32Array([-5, 7, 2, 13, -11, 3, 2, 4, -17]);
  const normals = new Int8Array([0, 127, 0, 127, 0, 0, 0, 0, -128]);
  const deltas = new Int32Array([2, -2, 1]);
  const bytes = new Uint8Array(positions.byteLength + 12 + deltas.byteLength);
  bytes.set(new Uint8Array(positions.buffer)); bytes.set(new Uint8Array(normals.buffer), positions.byteLength);
  bytes.set(new Uint8Array(deltas.buffer), positions.byteLength + 12);
  for (const index of ['u16', 'u32'] as const) {
    const decoded = readBakedGeometry(bytes, 0, { attrs: [['position', 'f32', 3, false], ['normal', 'i8', 3, true]],
      count: 3, index, indexCount: 3, box: true });
    try {
      expect(decoded.getAttribute('position').array).toEqual(positions);
      expect(decoded.getAttribute('normal').array).toEqual(normals);
      expect(decoded.index?.array).toEqual(index === 'u16' ? new Uint16Array([2, 0, 1]) : new Uint32Array([2, 0, 1]));
      expect(decoded.boundingBox?.min.toArray()).toEqual([-5, -11, -17]);
      expect(decoded.boundingBox?.max.toArray()).toEqual([13, 7, 3]);
    } finally { decoded.dispose(); }
  }
});

test('invalid baked positions retain the native bounds and diagnostic fallback', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      const positions = new Float32Array([bad, 0, 1, 2, 3, 4]);
      const oracle = new BufferGeometry().setAttribute('position', new BufferAttribute(positions, 3));
      errors.mockClear(); oracle.computeBoundingSphere(); oracle.computeBoundingBox();
      const messages = errors.mock.calls.map(call => String(call[0])); errors.mockClear();
      const decoded = readBakedGeometry(new Uint8Array(positions.buffer), 0,
        { attrs: [['position', 'f32', 3, false]], count: 2, index: null, indexCount: 0, box: true });
      try {
        expect(decoded.boundingSphere).toEqual(oracle.boundingSphere);
        expect(decoded.boundingBox).toEqual(oracle.boundingBox);
        expect(errors.mock.calls.map(call => String(call[0]))).toEqual(messages);
      } finally { decoded.dispose(); oracle.dispose(); }
    }
  } finally { errors.mockRestore(); }
});

import { expect, test } from 'vitest';
import { frameSummary } from '../scripts/parity/frame-bytes.mjs';

test('native frame metadata excludes pixels and leaves an exact nonzero-offset view untouched', () => {
  const backing = new Uint8Array(24).fill(91), data = backing.subarray(4, 20);
  const frame = { width: 2, height: 2, calls: 8, triangles: 12, lit: 3, player: [0, 1, 2], pixels: 'original digest', data };
  const summary = frameSummary(frame);
  expect(summary).toEqual({ bytes: 16, metadata: { width: 2, height: 2, calls: 8, triangles: 12, lit: 3, player: [0, 1, 2], pixels: 'original digest' } });
  expect(Object.hasOwn(summary.metadata, 'data')).toBe(false);
  expect(frame.data).toBe(data);
  expect([...backing]).toEqual(Array.from({ length: 24 }, () => 91));
});

test('invalid dimensions and incomplete or surplus RGBA storage refuse', () => {
  for (const [width, height, bytes] of [[0, 1, 4], [-1, 1, 4], [1.5, 1, 4], [Number.NaN, 1, 4], [1, Infinity, 4], [Number.MAX_SAFE_INTEGER, 2, 4], [2, 2, 15], [2, 2, 17]]) {
    if (width === undefined || height === undefined || bytes === undefined) throw new Error('Missing malformed readback fixture');
    expect(() => frameSummary({ width, height, data: new Uint8Array(bytes) })).toThrow('Invalid native RGBA readback');
  }
});

test('foreign storage cannot satisfy the RGBA byte contract', () => {
  for (const data of [new Uint16Array(2), [0, 0, 0, 0], 'AAAAAA==', null]) {
    const frame = { width: 1, height: 1, data: new Uint8Array(4) };
    Reflect.set(frame, 'data', data);
    expect(() => frameSummary(frame)).toThrow('Invalid native RGBA readback');
  }
});

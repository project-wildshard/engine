import { expect, test } from 'vitest';
import { bakedEdgeProfiles, type EdgeColour, type EdgeProfiles } from './edgeProfiles';

const palette: readonly [EdgeColour, EdgeColour, EdgeColour, EdgeColour] = [[0.13, 0.27, 0.51], [0.31, 0.47, 0.59], [0.61, 0.73, 0.89], [0.97, 0.83, 0.19]];
function bake(count: number, offset: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(24 + count * count * 8 + offset).subarray(offset), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(0, 0x52545357, true); view.setUint32(4, 1, true); view.setUint32(8, count, true); view.setFloat32(12, 500, true);
  for (let i = 0; i < count * count; i++) {
    view.setFloat32(24 + i * 4, i % 19 === 0 ? -0 : Math.sin(i) * 200, true);
    for (let c = 0; c < 4; c++) view.setUint8(24 + count * count * 4 + i * 4 + c, 1 + (i * 17 + c * 31) % 255);
  }
  return bytes;
}
/** Retain the former full-lattice Float32 decode and the original splat arithmetic. */
function original(bytes: Uint8Array): EdgeProfiles {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = view.getUint32(8, true), n = count * count;
  const heights = Float32Array.from({ length: n }, (_, i) => view.getFloat32(24 + i * 4, true));
  const colourAt = (index: number): EdgeColour => {
    const weights = Array.from({ length: 4 }, (_, i) => view.getUint8(24 + n * 4 + index * 4 + i)), sum = weights.reduce((a, b) => a + b, 0);
    const channel = (c: number): number => palette.reduce((total, rgb, i) => total + (rgb[c] ?? 0) * (weights[i] ?? 0) / sum, 0);
    return [channel(0), channel(1), channel(2)];
  };
  // The oracle retains its own boundary walk, independent of copyEdges.
  const edge = (side: 'north' | 'east' | 'south' | 'west') => {
    const row: number[] = [], colours: EdgeColour[] = [];
    for (let i = 0; i < count; i++) {
      const x = side === 'east' ? count - 1 : side === 'west' ? 0 : i;
      const z = side === 'north' ? count - 1 : side === 'south' ? 0 : i;
      const index = z * count + x, height = heights[index];
      if (height === undefined) throw new Error('Missing oracle boundary');
      row.push(height); colours.push(colourAt(index));
    }
    return { heights: row, colours, roadHeight: 0 };
  };
  return { north: edge('north'), east: edge('east'), south: edge('south'), west: edge('west') };
}
test.each([[256, 0], [256, 1], [257, 0], [257, 1]])('complete edge words match full lattice decoding (%i, offset %i)', (count, offset) => {
  const bytes = bake(count, offset), before = bytes.slice(), expected = original(bytes), actual = bakedEdgeProfiles(bytes, palette);
  expect(actual).toEqual(expected); expect(bytes).toEqual(before);
  bytes.fill(0); expect(actual).toEqual(expected);
});
test('boundary-only reads retain malformed layout, height, palette and empty splat refusals', () => {
  const bytes = bake(256, 1), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(() => bakedEdgeProfiles(bytes.subarray(0, -1), palette)).toThrow('Truncated');
  view.setFloat32(24, Number.NaN, true); expect(() => bakedEdgeProfiles(bytes, palette)).toThrow('edge height');
  view.setFloat32(24, 0, true); bytes.fill(0, 24 + 256 * 256 * 4, 28 + 256 * 256 * 4);
  expect(() => bakedEdgeProfiles(bytes, palette)).toThrow('Empty terrain boundary splat');
  expect(() => bakedEdgeProfiles(bake(256, 0), [[-1, 0, 0], palette[1], palette[2], palette[3]])).toThrow('edge colour');
  const invalid = bake(256, 0); new DataView(invalid.buffer).setUint32(4, 2, true);
  expect(() => bakedEdgeProfiles(invalid, palette)).toThrow('header');
  const trailer = new Uint8Array(bytes.length + 24); trailer.set(bake(256, 0));
  expect(() => bakedEdgeProfiles(trailer, palette)).toThrow('trailer');
});

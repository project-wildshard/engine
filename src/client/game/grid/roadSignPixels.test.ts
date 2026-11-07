import { expect, test } from 'vitest';
import { packRoadSignPixels } from './roadSignPixels';

/** Retained byte-wise atlas path, including bottom-up rows and independent red/green lookup. */
function original(pixels: Uint8ClampedArray, width: number, height: number, red: Uint8Array, green: Uint8Array): Uint8Array {
  const data = new Uint8Array(width * height * 2);
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * width * 4, to = y * width * 2;
    for (let x = 0; x < width; x++) { data[to + x * 2] = red[pixels[from + x * 4] ?? 0] ?? 0; data[to + x * 2 + 1] = green[pixels[from + x * 4 + 1] ?? 0] ?? 0; }
  }
  return data;
}
test.each([0, 1])('complete atlas words retain channels, alpha independence and row orientation (offset %s)', offset => {
  const width = 1024, height = 513, storage = new Uint8ClampedArray(width * height * 4 + offset + 3), pixels = storage.subarray(offset, offset + width * height * 4);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 31 + Math.floor(i / 7)) % 256;
  const red = Uint8Array.from({ length: 256 }, (_, i) => (i * 7 + 3) % 256), green = Uint8Array.from({ length: 256 }, (_, i) => 255 - i);
  const before = pixels.slice(), expected = original(pixels, width, height, red, green);
  const actual = packRoadSignPixels(pixels, width, height, red, green);
  expect(actual).toHaveLength(expected.length); expect(actual.every((value, index) => value === expected[index])).toBe(true);
  expect(pixels.every((value, index) => value === before[index])).toBe(true); expect(actual.buffer).not.toBe(pixels.buffer);
});
test('invalid coverage dimensions and lookup sizes refuse before publication', () => {
  const table = new Uint8Array(256), pixels = new Uint8ClampedArray(4);
  for (const [width, height] of [[0, 1], [-1, 1], [1.5, 1], [1, Infinity], [2, 1]] as const) expect(() => packRoadSignPixels(pixels, width, height, table, table)).toThrow('coverage planes');
  expect(() => packRoadSignPixels(pixels, 1, 1, table.subarray(1), table)).toThrow('coverage planes');
});

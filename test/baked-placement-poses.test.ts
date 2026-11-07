import { Color, Matrix4, Quaternion, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { bakedPlacementPoses } from '../src/shared/game/shardfile/bakedPlacementPoses';

// Retained scalar constructor from bakedTiles: compare native float64 matrix
// words, not rounded JSON. This is the old allocation path's byte oracle.
function original(words: Float32Array, index: number, names: readonly string[], drop: number) {
  const at = index * 10, x = words[at + 1] ?? 0, y = (words[at + 2] ?? 0) - drop, z = words[at + 3] ?? 0;
  const scale = words[at + 8] ?? 1, tint = words[at + 9] ?? 1;
  return { x, y, z, matrix: new Matrix4().compose(new Vector3(x, y, z), new Quaternion(words[at + 4] ?? 0, words[at + 5] ?? 0, words[at + 6] ?? 0, words[at + 7] ?? 1), new Vector3(scale, scale, scale)),
    color: new Color(tint, tint, tint), variant: names[words[at] ?? 0] ?? '' };
}

const bytes = (values: readonly number[]) => new Uint8Array(Float64Array.from(values).buffer);

test('baked family poses preserve every original word, index order, defaults and input', () => {
  const words = Float32Array.from([0, -0, 2.25, -9.5, 0.1, -0.2, 0.3, 0.4, -2, 0.6,
    1, 1e5, -1e-5, 4, -0, 0.5, 0, 0.8660254, 0, -0,
    3, 7, 8, 9, 0, 0, 0, 1, 1, 1]);
  const before = Uint8Array.from(new Uint8Array(words.buffer)), indices = [2, 0, 1, 0, 9], names = ['first', 'second'];
  for (const drop of [0, -0, 3.125]) {
    const poses = bakedPlacementPoses(words, indices, names, drop);
    for (const [i, index] of indices.entries()) {
      const actual = poses[i], expected = original(words, index, names, drop);
      if (actual === undefined) throw new Error('Missing baked copy');
      expect(bytes([actual.x, actual.y, actual.z, ...actual.matrix.elements, actual.color.r, actual.color.g, actual.color.b]))
        .toEqual(bytes([expected.x, expected.y, expected.z, ...expected.matrix.elements, expected.color.r, expected.color.g, expected.color.b]));
      expect(actual.variant).toBe(expected.variant);
    }
  }
  expect(new Uint8Array(words.buffer)).toEqual(before);
});

test('each baked copy owns its matrix and colour across duplicate indices and later calls', () => {
  const words = Float32Array.from([0, 1, 2, 3, 0, 0, 0, 1, 2, 0.75]);
  const [first, duplicate] = bakedPlacementPoses(words, [0, 0], ['only'], 0);
  if (first === undefined || duplicate === undefined) throw new Error('Missing duplicate copies');
  const expected = original(words, 0, ['only'], 0);
  first.matrix.elements.fill(9); first.color.setRGB(0, 0, 0);
  bakedPlacementPoses(Float32Array.from([0, 90, 80, 70, 1, 0, 0, 0, 5, 1]), [0], ['other'], 8);
  expect(duplicate.matrix.elements).toEqual(expected.matrix.elements);
  expect(duplicate.color).toEqual(expected.color);
  expect(duplicate.variant).toBe('only');
  expect(bakedPlacementPoses(words, [], ['only'], 0)).toEqual([]);
});

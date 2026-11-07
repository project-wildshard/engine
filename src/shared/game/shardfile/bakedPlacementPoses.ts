import { Color, Matrix4, Quaternion, Vector3 } from 'three';

/** One independently mutable baked copy, in the family's original index order. */
export interface BakedPlacementPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly matrix: Matrix4;
  readonly color: Color;
  readonly variant: string;
}

/** Compose the original float32 placement words without allocating three
 * temporary transform objects per copy. Matrices and colours stay private;
 * Matrix4.compose copies scalar values and retains none of the scratch objects. */
export function bakedPlacementPoses(words: Float32Array, indices: readonly number[], names: readonly string[], drop: number): BakedPlacementPose[] {
  const position = new Vector3(), rotation = new Quaternion(), size = new Vector3();
  return indices.map(index => {
    const offset = index * 10, x = words[offset + 1] ?? 0, y = (words[offset + 2] ?? 0) - drop, z = words[offset + 3] ?? 0;
    const scale = words[offset + 8] ?? 1, tint = words[offset + 9] ?? 1;
    const matrix = new Matrix4().compose(position.set(x, y, z),
      rotation.set(words[offset + 4] ?? 0, words[offset + 5] ?? 0, words[offset + 6] ?? 0, words[offset + 7] ?? 1), size.set(scale, scale, scale));
    return { x, y, z, matrix, color: new Color(tint, tint, tint), variant: names[words[offset] ?? 0] ?? '' };
  });
}

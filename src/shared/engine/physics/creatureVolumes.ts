import type { Quaternion, Vector3 } from 'three';

/** Admission compiles these once, in world metres. A sphere has zero halfLength. */
export interface CreatureHitVolume {
  readonly part: string;
  readonly multiplier: number;
  readonly radius: number;
  readonly halfLength: number;
}
/** One body's read-only collision pose. Reading never advances its clock or RNG. */
export interface CreatureVolumePose {
  readonly volumes: readonly CreatureHitVolume[];
  /** World endpoints; equal for a sphere, capsule axis otherwise. Caller owns buffers. */
  segment: (index: number, rear: Vector3, front: Vector3) => void;
  /** Opted-in clip poses lend the exact same local transforms to their skin view. */
  joint?: (name: string, position: Vector3, quaternion: Quaternion, scale: Vector3) => boolean;
  /** Only animated authority needs historical joint endpoints beyond the old root history. */
  capture?: () => CreatureVolumeFrame;
}

export interface CreatureVolumeFrame { readonly volumes: readonly CreatureHitVolume[]; readonly points: Float32Array }

/** Named aiming sockets on the same creature; selecting one never creates an entity. */
export interface CreatureLockPoints {
  readonly names: readonly string[];
  point: (index: number, out: Vector3) => Vector3;
}

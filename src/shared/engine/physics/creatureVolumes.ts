import type { Vector3 } from 'three';

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
}

/** Named aiming sockets on the same creature; selecting one never creates an entity. */
export interface CreatureLockPoints {
  readonly names: readonly string[];
  point: (index: number, out: Vector3) => Vector3;
}

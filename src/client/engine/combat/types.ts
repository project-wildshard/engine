import type { Matrix4, Vector3 } from 'three';

/** Optional attachment transform; rendering adapters own the scene object behind it. */
export interface TargetFrame { readonly matrixWorld: Matrix4 }
export interface TargetAnimal {
  hitFlash?: (strength: number) => void;
  applyDamage: (amount: number, point: Vector3, dir: Vector3) => boolean;
  damageFor: (headshot: boolean, dist: number) => number;
  kind: string;
  position: Vector3;
  alive: boolean;
  stagger?: (dir: Vector3, strength: number) => void;
  stuckFrame?: (point: Vector3) => TargetFrame | null;
  /** A body's own measures, where it has them: how high its middle stands. */
  readonly dims?: { readonly bodyY: number };
  readonly scale?: number;
}
export interface TargetHit { animal: TargetAnimal; point: Vector3; distance: number; headshot: boolean }
export interface Targets { raycast: (origin: Vector3, dir: Vector3, maxDist: number) => TargetHit | null }

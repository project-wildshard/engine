import type { Matrix4, Vector3 } from 'three';

/** Optional attachment transform; rendering adapters own the scene object behind it. */
export interface TargetFrame { readonly matrixWorld: Matrix4 }
export interface TargetAnimal {
  readonly species?: string;
  /** Ambient presentation owns this target; it has no replicated damage row. */
  readonly presentationOnly?: boolean;
  hitFlash?: (strength: number) => void;
  applyDamage: (amount: number, point: Vector3, dir: Vector3, part?: string) => boolean;
  damageFor: (headshot: boolean, dist: number) => number;
  kind: string;
  position: Vector3;
  alive: boolean;
  stagger?: (dir: Vector3, strength: number) => void;
  stuckFrame?: (point: Vector3) => TargetFrame | null;
  /** A body's own measures, where it has them: how high its middle stands, and how far round it its body reaches. */
  readonly dims?: { readonly bodyY: number; readonly bodyRadius?: number };
  readonly scale?: number;
}
export interface TargetHit { animal: TargetAnimal; point: Vector3; distance: number; headshot: boolean; part?: string; multiplier?: number }
export interface Targets { raycast: (origin: Vector3, dir: Vector3, maxDist: number) => TargetHit | null }

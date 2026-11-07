import type { Matrix4, Vector3 } from 'three';
import { CollisionPose, type CollisionJoint } from '@wildshard/engine/game/plugin/animation';
import type { LimbPose } from '../../../shared/game/animation/limbRig';

/** The four authored collision joints, parent-first; measured from the actual GLB by the trusted bake. */
export type LimbCollisionJoints = readonly [CollisionJoint, CollisionJoint, CollisionJoint, CollisionJoint];
export interface LimbCollisionVolumes {
  readonly head: readonly [number, number, number];
  readonly body: { readonly at: readonly [number, number, number]; readonly pitch: number; readonly halfLength: number };
  readonly fore: { readonly at: readonly [number, number, number]; readonly halfLength: number };
  readonly ribs: readonly [number, number, number];
}
const ZERO = [0, 0, 0] as const;

/** The page and native limb resolve the same scalar pose through this collision-only chain. No rig is created. */
export class LimbCollision {
  private readonly chain: CollisionPose;
  private readonly volumes: LimbCollisionVolumes;
  private readonly offset: [number, number, number] = [0, 0, 0];
  private readonly angles: [number, number, number] = [0, 0, 0];
  constructor(joints: LimbCollisionJoints, volumes: LimbCollisionVolumes) {
    this.volumes = volumes;
    this.chain = new CollisionPose(joints);
  }

  pose(p: LimbPose, world: Matrix4): void {
    this.offset[1] = p.rootY; this.offset[2] = p.rootZ;
    this.rotate(0, this.offset, p.rootPitch, p.rootYaw, p.rootRoll);
    this.rotate(1, ZERO, p.chestPitch, p.chestYaw, p.chestRoll);
    this.rotate(2, ZERO, p.neckPitch, p.neckYaw, 0);
    this.rotate(3, ZERO, p.headPitch, p.headYaw, p.headRoll);
    this.chain.solve(world);
  }
  private rotate(joint: number, offset: readonly [number, number, number], x: number, y: number, z: number): void {
    this.angles[0] = x; this.angles[1] = y; this.angles[2] = z;
    this.chain.set(joint, offset, this.angles);
  }
  head(out: Vector3): Vector3 { return this.chain.point(3, this.volumes.head, out); }
  body(rear: Vector3, front: Vector3): void {
    this.chain.capsule(0, this.volumes.body.at, 'z', this.volumes.body.pitch, this.volumes.body.halfLength, rear, front);
  }
  fore(left: Vector3, right: Vector3): void {
    this.chain.capsule(1, this.volumes.fore.at, 'x', 0, this.volumes.fore.halfLength, left, right);
  }
  ribs(out: Vector3): Vector3 { return this.chain.point(1, this.volumes.ribs, out); }
}

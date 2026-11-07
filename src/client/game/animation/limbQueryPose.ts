import * as v from 'valibot';
import { Vector3, type Matrix4 } from 'three';
import { newLimbPose, type LimbPose } from '../../../shared/game/animation/limbRig';
import { LimbCollision, type LimbCollisionJoints, type LimbCollisionVolumes } from './limbCollision';

const finite = v.pipe(v.number(), v.finite());
const triple = v.tuple([finite, finite, finite]);
const scalarPose = v.strictObject({ rootY: finite, rootZ: finite, rootPitch: finite, rootRoll: finite, rootYaw: finite,
  chestPitch: finite, chestYaw: finite, chestRoll: finite, neckPitch: finite, neckYaw: finite,
  headPitch: finite, headYaw: finite, headRoll: finite });
const savedPose: v.GenericSchema<BoundedLimbPoseInput, BoundedLimbPose> = v.strictObject({ version: v.literal(1), staged: scalarPose,
  published: v.strictObject({ head: triple, ribs: triple, rear: triple, front: triple, left: triple, right: triple }) });
export type LimbQueryPoseSaved = v.InferOutput<typeof savedPose>;
type Publication = 'body' | 'ribs' | 'head';
const scalarKeys = ['rootY', 'rootZ', 'rootPitch', 'rootRoll', 'rootYaw', 'chestPitch', 'chestYaw', 'chestRoll',
  'neckPitch', 'neckYaw', 'headPitch', 'headYaw', 'headRoll'] as const;
const tripleOf = (p: Vector3): [number, number, number] => [p.x, p.y, p.z];

/** The limb's consumer-specific matrix publication clocks. Posing never changes a cached query.
 * Body/head/fore queries read the last published worlds. A ribcage getWorldPosition publishes only
 * its root/chest parent chain; a head getter or render propagation publishes the entire chain.
 * This retains that observable ordering without constructing any live bones in the native host. */
export class LimbQueryPose {
  private readonly staged = newLimbPose();
  private readonly collision: LimbCollision;
  private readonly headPoint = new Vector3();
  private readonly ribsPoint = new Vector3();
  private readonly rear = new Vector3();
  private readonly front = new Vector3();
  private readonly left = new Vector3();
  private readonly right = new Vector3();

  constructor(joints: LimbCollisionJoints, volumes: LimbCollisionVolumes) {
    this.collision = new LimbCollision(joints, volumes);
  }

  /** Copy only the four collision joints' scalar offsets. Caller scratch poses may be reused immediately. */
  stage(pose: LimbPose): void {
    if (scalarKeys.some(key => !Number.isFinite(pose[key]))) throw new RangeError('Invalid limb query pose');
    for (let i = 0; i < 13; i++) {
      const key = scalarKeys[i];
      if (key === undefined) throw new Error('Missing limb pose scalar');
      this.staged[key] = pose[key];
    }
  }

  /** Copy the already published hitbox clock, without forcing bone propagation or allocating a snapshot. */
  copyFrom(source: LimbQueryPose): void {
    Object.assign(this.staged, source.staged);
    this.headPoint.copy(source.headPoint); this.ribsPoint.copy(source.ribsPoint);
    this.rear.copy(source.rear); this.front.copy(source.front);
    this.left.copy(source.left); this.right.copy(source.right);
  }

  /** Match updateWorldMatrix(true, false) on this joint; descendants retain their previously published worlds. */
  publish(frame: Matrix4, through: Publication): void {
    if (!frame.elements.every(Number.isFinite)) throw new RangeError('Invalid limb query frame');
    this.collision.pose(this.staged, frame);
    this.collision.body(this.rear, this.front);
    if (through !== 'body') {
      this.collision.ribs(this.ribsPoint);
      this.collision.fore(this.left, this.right);
    }
    if (through === 'head') this.collision.head(this.headPoint);
  }

  head(out: Vector3): Vector3 { return out.copy(this.headPoint); }
  ribs(out: Vector3): Vector3 { return out.copy(this.ribsPoint); }
  body(rear: Vector3, front: Vector3): void { rear.copy(this.rear); front.copy(this.front); }
  fore(left: Vector3, right: Vector3): void { left.copy(this.left); right.copy(this.right); }

  /** Retain exact cached outputs, not a recomputed pose: a checkpoint can sit between two publications. */
  snapshot(): LimbQueryPoseSaved {
    const staged = v.parse(scalarPose, Object.fromEntries(scalarKeys.map(key => [key, this.staged[key]])));
    return { version: 1, staged, published: { head: tripleOf(this.headPoint), ribs: tripleOf(this.ribsPoint),
      rear: tripleOf(this.rear), front: tripleOf(this.front), left: tripleOf(this.left), right: tripleOf(this.right) } };
  }

  /** Validate the entire continuation before mutating either the staged or published clock. Emits nothing. */
  restore(input: unknown): void {
    const saved = v.parse(savedPose, input);
    Object.assign(this.staged, saved.staged);
    this.headPoint.set(...saved.published.head); this.ribsPoint.set(...saved.published.ribs);
    this.rear.set(...saved.published.rear); this.front.set(...saved.published.front);
    this.left.set(...saved.published.left); this.right.set(...saved.published.right);
  }
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedLimbPoseInput = BoundedLimbPose;
interface BoundedLimbPoseFields {
    version: 1;
    staged: {
        rootY: number;
        rootZ: number;
        rootPitch: number;
        rootRoll: number;
        rootYaw: number;
        chestPitch: number;
        chestYaw: number;
        chestRoll: number;
        neckPitch: number;
        neckYaw: number;
        headPitch: number;
        headYaw: number;
        headRoll: number;
    };
    published: {
        head: [
            number,
            number,
            number
        ];
        ribs: [
            number,
            number,
            number
        ];
        rear: [
            number,
            number,
            number
        ];
        front: [
            number,
            number,
            number
        ];
        left: [
            number,
            number,
            number
        ];
        right: [
            number,
            number,
            number
        ];
    };
}
type BoundedLimbPose = { [Key in keyof BoundedLimbPoseFields]: BoundedLimbPoseFields[Key] };

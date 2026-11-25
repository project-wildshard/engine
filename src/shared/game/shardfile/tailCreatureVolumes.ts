import { Matrix4, Quaternion, Vector3 } from 'three';
import * as v from 'valibot';
import { CreatureBodySchema, type CreatureBody } from '@wildshard/format/creatureLayers';
import { MIN_VOLUME_RADIUS } from '@wildshard/format/creatureSkeletons';
import type { CreatureVolume } from '@wildshard/format/creatureVolumes';
import type { CreatureHitVolume, CreatureVolumePose } from '@wildshard/engine/physics/creatureVolumes';
import { trailPose, trailPush, trailRing, trailSampleDue, trailSeed, type TrailRing, type TrailSpec } from '@wildshard/engine/entities/trailBones';
import { ownedArray, type OwnedLabel } from '@wildshard/engine/core/ownedBuffer';
import { CollisionPose } from '../plugin/animation';
import { bodyContract } from './creatureContract';
import { RestCreatureVolumes, type CreatureRestJoint } from './creatureVolumes';

interface Root { readonly position: Vector3; readonly yaw: number; readonly scale: number }
interface TailVolume { readonly bone: number; readonly halfLength: number }
const TAIL_STATE: OwnedLabel = { owner: 'game/creatures', asset: 'tail-trail' };
const natural = v.pipe(v.number(), v.integer());
const TailRingStateSchema = v.strictObject({ head: natural, size: natural, points: v.array(v.pipe(v.number(), v.finite())) });

/**
 * A horizontal biped's hit volumes (ONE-FORMAT CC58b, Q-CC38: the T-Rex). Its body and head volumes are the biped's,
 * on the rest rig with the contract's spine pitch; its tail volumes ride trail bones that follow the path the hips drew
 * (CC22's ring, pushed on the 10 Hz sample ticks), tail bone k sitting k × spacing back from the hips. It walks: unlike
 * a serpent it keeps its motor, so the ring records the hips at their rest height over the walking root.
 */
export class TailCreatureVolumes implements CreatureVolumePose {
  readonly volumes: readonly CreatureHitVolume[];
  /** The tail's trail bones, hips outward. */
  readonly bones: readonly string[];
  readonly spec: TrailSpec;
  private readonly rest: RestCreatureVolumes;
  private readonly tail: readonly TailVolume[];
  private readonly ring: TrailRing;
  private readonly posed: Float64Array;
  private readonly hips: Vector3;
  private readonly key = ownedArray(Float64Array, 5, TAIL_STATE).fill(Number.NaN);
  private readonly anchorAt = new Vector3();
  private readonly centre = new Vector3();
  private readonly along = new Vector3();
  private readonly ahead = new Vector3();
  private readonly at = new Vector3();
  private readonly turn = new Quaternion();
  private readonly parentTurn = new Quaternion();
  private static readonly FORWARD = new Vector3(0, 0, 1);
  private static readonly UP = new Vector3(0, 1, 0);
  private readonly root: Root;
  constructor(input: CreatureBody, joints: readonly CreatureRestJoint[], root: Root) {
    this.root = root;
    const body = v.parse(CreatureBodySchema, input), contract = bodyContract(body);
    if (body.skeleton !== 'biped' || body.stance !== 'horizontal' || body.trail === undefined || contract?.trail === undefined) {
      throw new Error('Tail volumes need a horizontal biped body');
    }
    if (body.hits === 'clip') throw new Error('A horizontal biped poses its tail on its trail, not from clips');
    this.bones = contract.trail;
    const trailBones = new Set(this.bones);
    this.rest = new RestCreatureVolumes(body, joints, root, trailBones);
    // ring bone 0 is the hips; tail bone k is ring bone k
    this.spec = { count: this.bones.length + 1, spacing: body.trail.spacing * root.scale };
    const hipsIndex = joints.findIndex(row => row.name === 'hips');
    if (hipsIndex === -1) throw new Error('Missing creature volume bone hips');
    const pose = new CollisionPose(joints); pose.solve(new Matrix4());
    this.hips = pose.point(hipsIndex, [0, 0, 0], new Vector3()).multiplyScalar(root.scale);
    const definitions = new Map<string, CreatureVolume>(contract.volumes.map(row => [row.part, row]));
    for (const row of body.volumes ?? []) definitions.set(row.part, row);
    const tail: TailVolume[] = [], volumes: CreatureHitVolume[] = [...this.rest.volumes];
    for (const row of definitions.values()) {
      const bone = this.bones.indexOf(row.bone);
      if (bone === -1) continue;
      const radius = Math.max(MIN_VOLUME_RADIUS, row.radius * root.scale), halfLength = row.halfLength * root.scale;
      tail.push({ bone: bone + 1, halfLength });
      volumes.push({ part: row.part, multiplier: row.multiplier, radius, halfLength });
    }
    this.tail = tail; this.volumes = volumes;
    this.ring = trailRing(this.spec);
    this.posed = ownedArray(Float64Array, this.spec.count * 3, TAIL_STATE);
    trailSeed(this.ring, this.spec, this.anchor(), root.yaw);
  }
  /** Both sides call this every sim tick after the bodies move; it records the hips on the 10 Hz sample ticks. */
  sample(tick: number): void {
    if (!trailSampleDue(tick)) return;
    const at = this.anchor();
    trailPush(this.ring, at.x, at.y, at.z);
  }
  /** Lay a fresh rest tail straight behind the hips (a spawn, a respawn, a joiner with no history). */
  reseed(): void { trailSeed(this.ring, this.spec, this.anchor(), this.root.yaw); this.key.fill(Number.NaN); }
  /** Tail bone `index`'s (0 is `tail1`) world position on the current trail. */
  bone(index: number, out: Vector3): Vector3 {
    if (!Number.isInteger(index) || index < 0 || index >= this.bones.length) throw new Error('Unknown tail bone');
    return this.ringBone(index + 1, out);
  }
  /** A strike socket on a tail bone sits where that bone is now; any other socket is the rest rig's (undefined). */
  socket(name: string, out: Vector3): Vector3 | undefined {
    const index = this.bones.indexOf(name);
    return index === -1 ? undefined : this.bone(index, out);
  }
  segment(index: number, rear: Vector3, front: Vector3): void {
    const restCount = this.rest.volumes.length;
    if (index < restCount) { this.rest.segment(index, rear, front); return; }
    const row = this.tail[index - restCount]; if (row === undefined) throw new Error('Incompatible creature volume frame');
    this.ringBone(row.bone, this.centre);
    // along the tail toward the hips: from this bone to the one ahead of it
    this.ringBone(row.bone - 1, this.along).sub(this.centre);
    const length = this.along.length();
    if (length > 1e-9) this.along.multiplyScalar(row.halfLength / length); else this.along.set(0, 0, 0);
    rear.copy(this.centre).sub(this.along); front.copy(this.centre).add(this.along);
  }
  /**
   * CC58b2, the tail poser: lend the skin view a tail bone's local transform, so the drawn tail lies on the trail its
   * volumes sit on. A tail bone faces along the path toward the hips (rest forward +z: a rest tail runs straight back);
   * `tail1` is relative to the hips (the root's yaw, unrotated otherwise), every other bone to the bone ahead of it.
   */
  trailJoint(name: string, position: Vector3, quaternion: Quaternion, scale: Vector3): boolean {
    const index = this.bones.indexOf(name); if (index === -1) return false;
    const bone = index + 1, s = this.root.scale;
    this.facing(bone, this.turn);
    if (bone === 1) {
      const yaw = this.parentTurn.setFromAxisAngle(TailCreatureVolumes.UP, -this.root.yaw);
      this.ringBone(1, position).sub(this.anchor()).applyQuaternion(yaw).divideScalar(s);
      quaternion.copy(yaw).multiply(this.turn);
    } else {
      this.facing(bone - 1, this.parentTurn).invert();
      this.ringBone(bone, position).sub(this.ringBone(bone - 1, this.at)).applyQuaternion(this.parentTurn).divideScalar(s);
      quaternion.copy(this.parentTurn).multiply(this.turn);
    }
    scale.set(1, 1, 1);
    return true;
  }
  /** Ring bone `index`'s world facing: rest forward (+z) turned toward the bone ahead of it (bone 0 is the hips). */
  private facing(index: number, out: Quaternion): Quaternion {
    this.ringBone(index - 1, this.ahead).sub(this.ringBone(index, this.at));
    const length = this.ahead.length();
    return length > 1e-9 ? out.setFromUnitVectors(TailCreatureVolumes.FORWARD, this.ahead.divideScalar(length)) : out.identity();
  }
  snapshot(): { head: number; size: number; points: number[] } { return { head: this.ring.head, size: this.ring.size, points: [...this.ring.points] }; }
  restore(input: unknown): void {
    const { capacity } = this.ring, saved = v.parse(TailRingStateSchema, input);
    if (saved.size < 0 || saved.size > capacity || saved.head < -1 || saved.head >= capacity || saved.points.length !== capacity * 3) throw new Error('Incompatible trail continuation');
    this.ring.points.set(saved.points); this.ring.head = saved.head; this.ring.size = saved.size; this.key.fill(Number.NaN);
  }
  /** The hips' world position: the root plus the rest hips offset, turned by the root's yaw. */
  private anchor(): Vector3 {
    const { position: p, yaw } = this.root, h = this.hips, cos = Math.cos(yaw), sin = Math.sin(yaw);
    return this.anchorAt.set(p.x + h.x * cos + h.z * sin, p.y + h.y, p.z - h.x * sin + h.z * cos);
  }
  private ringBone(index: number, out: Vector3): Vector3 {
    const at = this.anchor(), key = this.key;
    if (key[0] !== at.x || key[1] !== at.y || key[2] !== at.z || key[3] !== this.ring.head || key[4] !== this.ring.size) {
      trailPose(this.ring, at, this.spec, this.posed);
      key[0] = at.x; key[1] = at.y; key[2] = at.z; key[3] = this.ring.head; key[4] = this.ring.size;
    }
    return out.set(this.posed[index * 3] ?? 0, this.posed[index * 3 + 1] ?? 0, this.posed[index * 3 + 2] ?? 0);
  }
}

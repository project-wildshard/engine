import { Quaternion, Vector3 } from 'three';
import * as v from 'valibot';
import { CreatureBodySchema, type CreatureBody } from '@wildshard/format/creatureLayers';
import { MIN_VOLUME_RADIUS, trailBoneNames } from '@wildshard/format/creatureSkeletons';
import type { CreatureVolume } from '@wildshard/format/creatureVolumes';
import type { CreatureHitVolume, CreatureVolumePose } from '@wildshard/engine/physics/creatureVolumes';
import { trailPose, trailPush, trailRing, trailSampleDue, trailSeed, type TrailRing, type TrailSpec } from '@wildshard/engine/entities/trailBones';
import { bodyContract } from './creatureContract';
import { ownedArray, type OwnedLabel } from '@wildshard/engine/core/ownedBuffer';

interface Root { readonly position: Vector3; readonly yaw: number; readonly scale: number }
interface TrailVolume { readonly bone: number; readonly halfLength: number; readonly radius: number }
const TRAIL_STATE: OwnedLabel = { owner: 'game/creatures', asset: 'serpent-trail' };
const natural = v.pipe(v.number(), v.integer());
const TrailRingStateSchema = v.strictObject({ head: natural, size: natural, points: v.array(v.pipe(v.number(), v.finite())) });

/**
 * A serpent's hit volumes on its trail bones (ONE-FORMAT CC23b). The body is its trail: bone 0 is the root (the head),
 * bone i sits i × spacing back along the path the root drew (CC22's ring, pushed on the 10 Hz sample ticks). Each volume
 * lies on its bone along the path; a volume wholly under the ground is off, so a burrowed serpent's buried segments
 * cannot be hit while the surfaced ones can. A serpent has no walking capsule (motor `none`): moves place it, and its
 * height is the path's, never the ground follow's.
 */
export class TrailCreatureVolumes implements CreatureVolumePose {
  readonly volumes: readonly CreatureHitVolume[];
  readonly motorless = true;
  readonly bones: readonly string[];
  readonly spec: TrailSpec;
  private readonly ring: TrailRing;
  private readonly rows: readonly TrailVolume[];
  private readonly posed: Float64Array;
  private readonly key = ownedArray(Float64Array, 5, TRAIL_STATE).fill(Number.NaN);
  private readonly centre = new Vector3();
  private readonly along = new Vector3();
  private readonly at = new Vector3();
  private readonly ahead = new Vector3();
  private readonly turn = new Quaternion();
  private readonly parentTurn = new Quaternion();
  private static readonly FORWARD = new Vector3(0, 0, 1);
  private static readonly UP = new Vector3(0, 1, 0);
  private readonly root: Root;
  private readonly ground: (x: number, z: number) => number;
  constructor(input: CreatureBody, root: Root, ground: (x: number, z: number) => number) {
    this.root = root; this.ground = ground;
    const body = v.parse(CreatureBodySchema, input), contract = bodyContract(body);
    if (body.skeleton !== 'serpent' || body.trail === undefined || contract === undefined) throw new Error('Trail volumes need a serpent body');
    if (body.hits === 'clip') throw new Error('A serpent poses its volumes on its trail, not from clips');
    if (!Number.isFinite(root.scale) || root.scale <= 0) throw new Error('Invalid creature volume scale');
    this.bones = trailBoneNames(body.trail.count);
    this.spec = { count: body.trail.count, spacing: body.trail.spacing * root.scale };
    const definitions = new Map<string, CreatureVolume>(contract.volumes.map(row => [row.part, row]));
    for (const row of body.volumes ?? []) definitions.set(row.part, row);
    const rows: TrailVolume[] = [], volumes: CreatureHitVolume[] = [];
    for (const row of definitions.values()) {
      const bone = this.bones.indexOf(row.bone);
      if (bone === -1) throw new Error(`A serpent volume sits on a trail bone, not ${row.bone}`);
      const radius = Math.max(MIN_VOLUME_RADIUS, row.radius * root.scale), halfLength = row.halfLength * root.scale;
      rows.push({ bone, halfLength, radius });
      volumes.push({ part: row.part, multiplier: row.multiplier, radius, halfLength });
    }
    this.rows = rows; this.volumes = volumes;
    this.ring = trailRing(this.spec);
    this.posed = ownedArray(Float64Array, this.spec.count * 3, TRAIL_STATE);
    trailSeed(this.ring, this.spec, root.position, root.yaw);
  }
  /** Both sides call this every sim tick after the bodies move; it records the root on the 10 Hz sample ticks. */
  sample(tick: number): void {
    if (trailSampleDue(tick)) trailPush(this.ring, this.root.position.x, this.root.position.y, this.root.position.z);
  }
  /** Lay a fresh rest trail behind the root (a spawn, a respawn, a joiner with no history). */
  reseed(): void { trailSeed(this.ring, this.spec, this.root.position, this.root.yaw); this.key.fill(Number.NaN); }
  /** Bone `index`'s world position on the current trail. */
  bone(index: number, out: Vector3): Vector3 {
    if (!Number.isInteger(index) || index < 0 || index >= this.spec.count) throw new Error('Unknown trail bone');
    const posed = this.pose();
    return out.set(posed[index * 3] ?? 0, posed[index * 3 + 1] ?? 0, posed[index * 3 + 2] ?? 0);
  }
  segment(index: number, rear: Vector3, front: Vector3): void {
    const row = this.rows[index]; if (row === undefined) throw new Error('Incompatible creature volume frame');
    this.bone(row.bone, this.centre);
    // along the path toward the head: from this bone to the one ahead (the head points away from bone 1)
    if (row.bone === 0) this.bone(1, this.along).sub(this.centre).negate(); else this.bone(row.bone - 1, this.along).sub(this.centre);
    const length = this.along.length();
    if (length > 1e-9) this.along.multiplyScalar(row.halfLength / length); else this.along.set(0, 0, 0);
    rear.copy(this.centre).sub(this.along); front.copy(this.centre).add(this.along);
  }
  /**
   * CC23c, the serpent poser: lend the skin view each trail bone's local transform, so the drawn body lies on the same
   * trail the hit volumes do. A bone faces along the path toward the head (rest forward +z); the head is relative to the
   * view's root (the body's position and yaw, scaled by its scale), every other bone to the bone ahead of it.
   */
  joint(name: string, position: Vector3, quaternion: Quaternion, scale: Vector3): boolean {
    const index = this.bones.indexOf(name); if (index === -1) return false;
    const s = this.root.scale;
    this.facing(index, this.turn);
    if (index === 0) {
      const yaw = this.parentTurn.setFromAxisAngle(TrailCreatureVolumes.UP, -this.root.yaw);
      this.bone(0, position).sub(this.root.position).applyQuaternion(yaw).divideScalar(s);
      quaternion.copy(yaw).multiply(this.turn);
    } else {
      this.facing(index - 1, this.parentTurn).invert();
      this.bone(index, position).sub(this.bone(index - 1, this.at)).applyQuaternion(this.parentTurn).divideScalar(s);
      quaternion.copy(this.parentTurn).multiply(this.turn);
    }
    scale.set(1, 1, 1);
    return true;
  }
  /** Bone `index`'s world facing: rest forward (+z) turned onto the path toward the head. */
  private facing(index: number, out: Quaternion): Quaternion {
    this.bone(index, this.ahead);
    if (index === 0) this.ahead.sub(this.bone(1, this.at)); else this.ahead.negate().add(this.bone(index - 1, this.at));
    const length = this.ahead.length();
    return length > 1e-9 ? out.setFromUnitVectors(TrailCreatureVolumes.FORWARD, this.ahead.divideScalar(length)) : out.identity();
  }
  /** A volume whose top is under the ground at its centre is buried: it cannot be hit and it does not collide. */
  off(index: number): boolean {
    const row = this.rows[index]; if (row === undefined) throw new Error('Incompatible creature volume frame');
    const centre = this.bone(row.bone, this.centre);
    return centre.y + row.radius < this.ground(centre.x, centre.z);
  }
  /** Every volume buried: the whole serpent is under the sand. */
  get buried(): boolean { for (let index = 0; index < this.rows.length; index++) if (!this.off(index)) return false; return true; }
  /** The saved ring: its newest index, its size and every point (capacity × xyz). */
  snapshot(): { head: number; size: number; points: number[] } { return { head: this.ring.head, size: this.ring.size, points: [...this.ring.points] }; }
  restore(input: unknown): void {
    const { capacity } = this.ring, saved = v.parse(TrailRingStateSchema, input);
    if (saved.size < 0 || saved.size > capacity || saved.head < -1 || saved.head >= capacity || saved.points.length !== capacity * 3) throw new Error('Incompatible trail continuation');
    this.ring.points.set(saved.points); this.ring.head = saved.head; this.ring.size = saved.size; this.key.fill(Number.NaN);
  }
  /** The trail bones for the current root and ring, posed once per change. */
  private pose(): Float64Array {
    const p = this.root.position, key = this.key;
    if (key[0] !== p.x || key[1] !== p.y || key[2] !== p.z || key[3] !== this.ring.head || key[4] !== this.ring.size) {
      trailPose(this.ring, p, this.spec, this.posed);
      key[0] = p.x; key[1] = p.y; key[2] = p.z; key[3] = this.ring.head; key[4] = this.ring.size;
    }
    return this.posed;
  }
}

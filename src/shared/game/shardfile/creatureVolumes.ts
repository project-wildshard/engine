import { Matrix4, Vector3 } from 'three';
import { parse } from 'valibot';
import { CreatureBodySchema, type CreatureBody } from '@wildshard/format/creatureLayers';
import { MIN_VOLUME_RADIUS } from '@wildshard/format/creatureSkeletons';
import { bodyContract } from './creatureContract';
import type { CreatureVolume } from '@wildshard/format/creatureVolumes';
import type { CreatureVolumePose, CreatureHitVolume } from '@wildshard/engine/physics/creatureVolumes';
import { CollisionPose, type CollisionJoint } from '../plugin/animation';

export interface CreatureRestJoint extends CollisionJoint { readonly name: string }
interface Root { readonly position: Vector3; readonly yaw: number; readonly scale: number }
interface RestVolume { readonly rear: Vector3; readonly front: Vector3 }
const ORIGIN = [0, 0, 0] as const;
const NO_BONES: ReadonlySet<string> = new Set();

/** The rest rig solved with the contract's forward pitch on its bone (CC58b: a horizontal biped's spine), so volumes and
 * sockets above that bone lean out over the legs as the page draws them. */
export function restPose(joints: readonly CreatureRestJoint[], pitch: { readonly bone: string; readonly angle: number } | undefined): CollisionPose {
  const pose = new CollisionPose(joints);
  if (pitch !== undefined) {
    const index = joints.findIndex(row => row.name === pitch.bone);
    if (index === -1) throw new Error(`Missing creature pitch bone ${pitch.bone}`);
    pose.set(index, ORIGIN, [pitch.angle, 0, 0]);
  }
  pose.solve(new Matrix4());
  return pose;
}

/** Skeleton defaults plus authored part replacements, compiled against the real rest rig.
 * This has no controller, scene nodes, animation clock or saved mutable state. */
export class RestCreatureVolumes implements CreatureVolumePose {
  readonly volumes: readonly CreatureHitVolume[];
  private readonly rest: readonly RestVolume[];
  private readonly root: Root;
  private readonly scale: number;
  /** `skip`: bones another poser owns (CC58b: a horizontal biped's tail trail bones). */
  constructor(input: CreatureBody, joints: readonly CreatureRestJoint[], root: Root, skip: ReadonlySet<string> = NO_BONES) {
    const body = parse(CreatureBodySchema, input);
    if (body.hits === 'clip') throw new Error('Clip hits require a published clip-volume pose');
    if (!Number.isFinite(root.scale) || root.scale <= 0) throw new Error('Invalid creature volume scale');
    this.root = root; this.scale = root.scale;
    const contract = bodyContract(body), defaults = contract?.volumes ?? [];
    const definitions = new Map<string, CreatureVolume>(defaults.map(row => [row.part, row]));
    for (const row of body.volumes ?? []) definitions.set(row.part, row);
    for (const [part, row] of definitions) if (skip.has(row.bone)) definitions.delete(part);
    if (definitions.size === 0) throw new Error('Creature volumes need a skeleton or authored volumes');
    const names = new Map(joints.map((row, index) => [row.name, index]));
    if (names.size !== joints.length) throw new Error('Duplicate creature rest joint');
    const pose = restPose(joints, contract?.pitch);
    const rest: RestVolume[] = [], volumes: CreatureHitVolume[] = [];
    const centre = new Vector3(), axis = new Vector3();
    for (const row of definitions.values()) {
      const index = names.get(row.bone);
      if (index === undefined) throw new Error(`Missing creature volume bone ${row.bone}`);
      const rear = new Vector3(), front = new Vector3(), at = row.at ?? ORIGIN;
      pose.point(index, at, centre);
      let stretch = 0;
      for (let n = 0; n < 3; n++) {
        const offset: [number, number, number] = [at[0], at[1], at[2]]; offset[n] = (offset[n] ?? 0) + 1;
        pose.point(index, offset, axis); stretch = Math.max(stretch, axis.distanceTo(centre));
      }
      pose.capsule(index, at, row.axis, 0, row.halfLength, rear, front);
      volumes.push({ part: row.part, multiplier: row.multiplier,
        radius: Math.max(MIN_VOLUME_RADIUS, row.radius * stretch * root.scale), halfLength: rear.distanceTo(front) * root.scale / 2 });
      rest.push({ rear: rear.multiplyScalar(root.scale), front: front.multiplyScalar(root.scale) });
    }
    this.volumes = volumes; this.rest = rest;
  }
  segment(index: number, rear: Vector3, front: Vector3): void {
    const row = this.rest[index], { root } = this;
    if (row === undefined || root.scale !== this.scale) throw new Error('Incompatible creature volume frame');
    const cos = Math.cos(root.yaw), sin = Math.sin(root.yaw), p = root.position;
    rear.set(p.x + row.rear.x * cos + row.rear.z * sin, p.y + row.rear.y, p.z - row.rear.x * sin + row.rear.z * cos);
    front.set(p.x + row.front.x * cos + row.front.z * sin, p.y + row.front.y, p.z - row.front.x * sin + row.front.z * cos);
  }
}

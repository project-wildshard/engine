import { Matrix4, Vector3 } from 'three';
import type { CreatureBody } from '@wildshard/format/creatureLayers';
import { CREATURE_SKELETONS } from '@wildshard/format/creatureSkeletons';
import type { CreatureLockPoints } from '@wildshard/engine/physics/creatureVolumes';
import { CollisionPose } from '../plugin/animation';
import type { CreatureRestJoint } from './creatureVolumes';

/** Immutable rest sockets, moved by the actual root. No scene, clock or controller. */
export class RestCreatureSockets implements CreatureLockPoints {
  readonly names: readonly string[];
  private readonly rest: readonly Vector3[];
  constructor(body: CreatureBody, joints: readonly CreatureRestJoint[],
    private readonly root: { readonly position: Vector3; readonly yaw: number; readonly scale: number }) {
    const skeleton = body.skeleton === undefined ? undefined : CREATURE_SKELETONS[body.skeleton];
    this.names = body.lock ?? (skeleton === undefined ? [] : [skeleton.lock]);
    if (this.names.length === 0 || this.names.length > 16 || new Set(this.names).size !== this.names.length) throw new Error('Invalid creature lock sockets');
    const pose = new CollisionPose(joints); pose.solve(new Matrix4());
    this.rest = this.names.map(name => {
      const socket = skeleton?.sockets[name], bone = socket?.bone ?? name, index = joints.findIndex(row => row.name === bone);
      if (index === -1) throw new Error(`Missing creature lock socket ${name} (bone ${bone})`);
      const out = new Vector3(); pose.point(index, socket?.at ?? [0, 0, 0], out); return out;
    });
  }
  point(index: number, out: Vector3): Vector3 {
    const at = this.rest[index], { position: p, yaw, scale } = this.root;
    if (at === undefined || !Number.isFinite(scale) || scale <= 0) throw new Error('Invalid creature lock frame');
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    return out.set(p.x + scale * (at.x * cos + at.z * sin), p.y + scale * at.y, p.z + scale * (-at.x * sin + at.z * cos));
  }
}

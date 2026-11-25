import { Vector3 } from 'three';
import type { CreatureBody } from '@wildshard/format/creatureLayers';
import { bodyContract } from './creatureContract';
import type { CreatureLockPoints } from '@wildshard/engine/physics/creatureVolumes';
import { restPose, type CreatureRestJoint } from './creatureVolumes';

/** Admitted sockets, positioned by the actual root or the existing collision pose. */
export class CreatureSockets implements CreatureLockPoints {
  readonly names: readonly string[];
  private readonly sockets: readonly { index: number; at: readonly [number, number, number]; rest: Vector3 }[];
  private readonly root: { readonly position: Vector3; readonly yaw: number; readonly scale: number };
  private readonly strike: { readonly names: readonly string[];
      /** A posed socket position, or undefined to keep the rest rig's (CC58b: a tail socket is posed, a mouth is not). */
      readonly posed?: (index: number, at: readonly [number, number, number], out: Vector3) => Vector3 | undefined } | undefined;
  constructor(body: CreatureBody, joints: readonly CreatureRestJoint[],
    root: { readonly position: Vector3; readonly yaw: number; readonly scale: number },
    strike?: { readonly names: readonly string[];
      /** A posed socket position, or undefined to keep the rest rig's (CC58b: a tail socket is posed, a mouth is not). */
      readonly posed?: (index: number, at: readonly [number, number, number], out: Vector3) => Vector3 | undefined }) {
    this.root = root; this.strike = strike;
    const skeleton = bodyContract(body);
    this.names = strike?.names ?? body.lock ?? (skeleton === undefined ? [] : [skeleton.lock]);
    if (this.names.length === 0 || this.names.length > (strike === undefined ? 16 : 32) || new Set(this.names).size !== this.names.length) {
      throw new Error(`Invalid creature ${strike === undefined ? 'lock' : 'strike'} sockets`);
    }
    const pose = restPose(joints, skeleton?.pitch);
    this.sockets = this.names.map(name => {
      const socket = skeleton?.sockets[name], bone = socket?.bone ?? name, index = joints.findIndex(row => row.name === bone);
      if (index === -1) throw new Error(`Missing creature ${strike === undefined ? 'lock' : 'strike'} socket ${name} (bone ${bone})`);
      const at = socket?.at ?? [0, 0, 0] as const;
      return { index, at, rest: pose.point(index, at, new Vector3()) };
    });
  }
  point(index: number, out: Vector3): Vector3 {
    const socket = this.sockets[index], { position: p, yaw, scale } = this.root;
    if (socket === undefined || !Number.isFinite(scale) || scale <= 0) {
      throw new Error(`Invalid creature ${this.strike === undefined ? 'lock' : 'strike'} frame`);
    }
    if (this.strike?.posed !== undefined && this.strike.posed(socket.index, socket.at, out) !== undefined) return out;
    const at = socket.rest;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    return out.set(p.x + scale * (at.x * cos + at.z * sin), p.y + scale * at.y, p.z + scale * (-at.x * sin + at.z * cos));
  }
}

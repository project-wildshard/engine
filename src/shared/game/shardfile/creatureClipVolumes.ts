import { Vector3, type Quaternion } from 'three';
import type { CreatureBody } from '@wildshard/format/creatureLayers';
import { MIN_VOLUME_RADIUS } from '@wildshard/format/creatureSkeletons';
import { bodyContract } from './creatureContract';
import type { CreatureVolume } from '@wildshard/format/creatureVolumes';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { CreatureVolumeFrame, CreatureVolumePose } from '@wildshard/engine/physics/creatureVolumes';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
import { CreatureClipSampler } from './creatureClipSampler';
import { creatureClipName } from './creatureClipChoice';
import type { SkinClipMap } from '@wildshard/format/skins';
import type { CreatureRestJoint } from './creatureVolumes';

/** Giant-only numeric clip authority. Time and damage/attack state remain owned
 * by the existing host and actor; reads never step or create playback clocks. */
export class ClipCreatureVolumes implements CreatureVolumePose {
  private readonly sampler: CreatureClipSampler;
  private readonly definitions: readonly { row: CreatureVolume; index: number }[];
  private readonly shapes: { part: string; multiplier: number; radius: number; halfLength: number }[];
  private readonly endpoints: { rear: Vector3; front: Vector3 }[];
  private frame = '';
  private readonly centre = new Vector3(); private readonly axis = new Vector3();
  private readonly actor: AnimalSim;
  private readonly now: () => number;
  private readonly attackSpan: number;
  private readonly clipMap: SkinClipMap | undefined;
  constructor(body: CreatureBody, bytes: Uint8Array, joints: readonly CreatureRestJoint[], actor: AnimalSim,
    now: () => number, attackSpan: number, clipMap?: SkinClipMap) {
    this.actor = actor; this.now = now; this.attackSpan = attackSpan; this.clipMap = clipMap;
    if (body.size !== 'giant' || body.hits !== 'clip') throw new Error('Clip hit authority needs an opted-in giant');
    this.sampler = new CreatureClipSampler(bytes, joints);
    if (!this.sampler.has(creatureClipName('idle', clipMap, this.sampler))) throw new Error('Clip hit authority needs an idle clip');
    const defaults = bodyContract(body)?.volumes ?? [];
    const rows = new Map<string, CreatureVolume>(defaults.map(row => [row.part, row]));
    for (const row of body.volumes ?? []) rows.set(row.part, row);
    if (rows.size === 0 || rows.size > 16) throw new Error('Invalid clip creature volumes');
    this.definitions = [...rows.values()].map(row => {
      const index = joints.findIndex(joint => joint.name === row.bone); if (index === -1) throw new Error(`Missing creature volume bone ${row.bone}`);
      return { row, index };
    });
    this.shapes = this.definitions.map(({ row }) => ({ part: row.part, multiplier: row.multiplier, radius: MIN_VOLUME_RADIUS, halfLength: 0 }));
    this.endpoints = this.definitions.map(() => ({ rear: new Vector3(), front: new Vector3() }));
  }
  get volumes(): CreatureVolumePose['volumes'] { this.refresh(); return this.shapes; }
  private refresh(): void {
    const a = this.actor, sampler = this.sampler, now = this.now();
    const idle = creatureClipName('idle', this.clipMap, sampler), die = creatureClipName('die', this.clipMap, sampler);
    const ability = a.runningAbility, progress = ability?.progress ?? a.attackPhase;
    const attack = creatureClipName('attack', this.clipMap, sampler, ability), reaction = creatureClipName('hit', this.clipMap, sampler);
    const walk = creatureClipName('walk', this.clipMap, sampler), graze = creatureClipName('idle.graze', this.clipMap, sampler);
    let name = idle, time = now, loop = true;
    const hit = now - a.lastHitT / 1000;
    if (!a.alive && sampler.has(die)) { name = die; time = Math.max(0, a.deathTime); loop = false; }
    else if (progress >= 0 && sampler.has(attack)) { name = attack; time = progress * this.attackSpan; loop = false; }
    else if (hit >= 0 && sampler.has(reaction) && hit < sampler.duration(reaction)) { name = reaction; time = hit; loop = false; }
    else if (Math.hypot(a.speed, a.strafe) / a.scale > .15 && sampler.has(walk)) name = walk;
    else if (a.state === 'graze' && sampler.has(graze)) name = graze;
    const scale = a.scale, key = `${name}:${time}:${scale}:${loop}`;
    if (key === this.frame) return;
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid creature clip scale');
    const pose = sampler.sample(name, time, loop);
    this.definitions.forEach(({ row, index }, part) => {
      const shape = this.shapes[part], endpoints = this.endpoints[part];
      if (shape === undefined || endpoints === undefined) throw new Error('Missing creature clip part');
      const at = row.at ?? [0, 0, 0]; pose.point(index, at, this.centre);
      let stretch = 0;
      for (let axis = 0; axis < 3; axis++) {
        const offset: [number, number, number] = [at[0], at[1], at[2]]; offset[axis] = (offset[axis] ?? 0) + 1;
        pose.point(index, offset, this.axis); stretch = Math.max(stretch, this.axis.distanceTo(this.centre));
      }
      pose.capsule(index, at, row.axis, 0, row.halfLength, endpoints.rear, endpoints.front);
      shape.radius = Math.max(MIN_VOLUME_RADIUS, row.radius * stretch * scale); shape.halfLength = endpoints.rear.distanceTo(endpoints.front) * scale / 2;
      endpoints.rear.multiplyScalar(scale); endpoints.front.multiplyScalar(scale);
    });
    this.frame = key;
  }
  segment(index: number, rear: Vector3, front: Vector3): void {
    this.refresh(); const row = this.endpoints[index]; if (row === undefined) throw new Error('Missing creature clip segment');
    this.toWorld(row.rear, rear); this.toWorld(row.front, front);
  }
  private toWorld(at: Vector3, out: Vector3): Vector3 {
    const { position: p, yaw } = this.actor, cos = Math.cos(yaw), sin = Math.sin(yaw);
    return out.set(p.x + at.x * cos + at.z * sin, p.y + at.y, p.z - at.x * sin + at.z * cos);
  }
  socket(index: number, at: readonly [number, number, number], out: Vector3): Vector3 {
    this.refresh();
    this.sampler.point(index, at, out).multiplyScalar(this.actor.scale);
    return this.toWorld(out, out);
  }
  joint(name: string, position: Vector3, quaternion: Quaternion, scale: Vector3): boolean {
    this.refresh(); return this.sampler.joint(name, position, quaternion, scale);
  }
  capture(): CreatureVolumeFrame {
    const volumes = this.volumes.map(row => ({ ...row })), rear = new Vector3(), front = new Vector3();
    const points = ownedArray(Float32Array, volumes.length * 6, { owner: 'creature clip volumes', asset: 'collision frame', kind: 'physics' });
    volumes.forEach((_row, index) => { this.segment(index, rear, front); points.set(rear.toArray(), index * 6); points.set(front.toArray(), index * 6 + 3); });
    return { volumes, points };
  }
}

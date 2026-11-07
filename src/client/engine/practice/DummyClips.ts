/** E336: offline UniMate clips blended on the original rig, before immediate additive hit springs. */
import * as THREE from 'three';
import { loadRigFile, bindRig, type RigContract, type RigBake } from '../anim/rig';
import type { DummyVariant } from './TrainingDummy';

let library: Promise<THREE.AnimationClip[]> | undefined;
export function loadDummyClips(variant: DummyVariant): Promise<THREE.AnimationClip[]> {
  library ??= loadRigFile('/assets/practice/dummies/unimate-motion.glb').then((gltf) => gltf.animations);
  return library.then((clips) => clips.filter((clip) => clip.name.startsWith(`${variant}:`)));
}

export function dummyClipContract(variant: DummyVariant): { contract: RigContract; bake: RigBake } {
  const clips = { idle: `${variant}:idle`, 'hit.body': `${variant}:body-hit`, 'hit.head': `${variant}:head-hit`,
    'hit.left': `${variant}:hit-left`, 'hit.right': `${variant}:hit-right`, 'hit.heavy': `${variant}:heavy-hit` } as const;
  return { contract: { skeleton: 'dummy.humanoid', clips: ['idle', 'hit.body', 'hit.head', 'hit.left', 'hit.right', 'hit.heavy'], sockets: [] }, bake: { skeleton: 'dummy.humanoid', clips } };
}

export class DummyClips {
  private readonly bones: { bone: THREE.Object3D; rest: THREE.Quaternion; base: THREE.Quaternion;
    from: THREE.Quaternion; tracks: Map<string, THREE.KeyframeTrack> }[] = [];
  private readonly idle: THREE.AnimationClip;
  private readonly reactions = new Map<string, THREE.AnimationClip>();
  private current: THREE.AnimationClip | null = null;
  private time = 0;
  private idleTime: number;
  private speed = 1;
  private weight = 1;
  private transition = 1;
  private readonly sampleA = new THREE.Quaternion();
  private readonly sampleB = new THREE.Quaternion();
  private readonly target = new THREE.Quaternion();

  constructor(root: THREE.Object3D, clips: readonly THREE.AnimationClip[], variant: DummyVariant) {
    const { contract, bake } = dummyClipContract(variant);
    bindRig(root, clips, contract, bake);
    const idle = clips.find((clip) => clip.name === `${variant}:idle`);
    if (!idle) throw new Error('Dummy motion library lacks idle');
    this.idle = idle;
    // Avoid three synchronized two-second loops in the lineup.
    this.idleTime = variant === 'wood' ? 0.2 : variant === 'straw-cloth' ? 0.85 : 1.4;
    for (const clip of clips) {
      if (clip === idle) continue;
      this.reactions.set(clip.name.slice(variant.length + 1), clip);
    }
    for (const track of idle.tracks) {
      const bone = root.getObjectByName(track.name.replace(/\.quaternion$/, ''));
      if (!bone || !(track instanceof THREE.QuaternionKeyframeTrack)) continue;
      const rest = bone.quaternion.clone(), tracks = new Map<string, THREE.KeyframeTrack>();
      for (const clip of clips) {
        const matching = clip.tracks.find((candidate) => candidate.name === track.name);
        if (matching) tracks.set(clip.name, matching);
      }
      this.bones.push({ bone, rest, base: rest.clone(), from: rest.clone(), tracks });
    }
  }

  hit(name: string, weight: number, mass: number): void {
    const next = this.reactions.get(name);
    if (!next) return;
    this.current = next;
    this.time = 0; this.transition = 0;
    this.speed = 1.35 / Math.sqrt(mass);
    this.weight = Math.min(1, Math.max(0.25, weight / mass));
    for (const entry of this.bones) entry.from.copy(entry.base);
  }

  /** Always writes a complete base pose. Mixer property caching would otherwise accumulate additive springs. */
  update(dt: number): void {
    this.idleTime = (this.idleTime + dt) % this.idle.duration;
    this.time += dt * this.speed;
    this.transition = Math.min(1, this.transition + dt / 0.09);
    if (this.current && this.time >= this.current.duration) this.current = null;
    for (const entry of this.bones) {
      const idleTrack = entry.tracks.get(this.idle.name);
      this.target.copy(entry.rest);
      if (idleTrack) this.sample(idleTrack, this.idleTime, this.target);
      if (this.current) {
        const track = entry.tracks.get(this.current.name);
        if (track) {
          this.sample(track, this.time, this.sampleA);
          const fade = Math.min(1, Math.max(0, (this.current.duration - this.time) / 0.2));
          this.target.slerp(this.sampleA, this.weight * fade);
        }
      }
      entry.base.copy(entry.from).slerp(this.target, this.transition);
      entry.bone.quaternion.copy(entry.base);
    }
  }

  private sample(track: THREE.KeyframeTrack, time: number, out: THREE.Quaternion): void {
    const times = track.times, values = track.values;
    let i = 0;
    while (i + 1 < times.length && (times[i + 1] ?? Infinity) <= time) i++;
    const j = Math.min(i + 1, times.length - 1);
    out.fromArray(values, i * 4);
    this.sampleB.fromArray(values, j * 4);
    const start = times[i] ?? 0, end = times[j] ?? start;
    out.slerp(this.sampleB, end > start ? Math.min(1, Math.max(0, (time - start) / (end - start))) : 0).normalize();
  }
}

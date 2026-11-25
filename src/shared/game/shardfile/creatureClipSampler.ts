import { LinearInterpolant, Matrix4, Quaternion, Vector3 } from 'three';
import * as v from 'valibot';
import { parseGlbData } from '@wildshard/format/glbCost';
import { glbBuffers } from '@wildshard/format/glbBuffers';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
import { CollisionPose } from '../plugin/animation';
import type { CreatureRestJoint } from './creatureVolumes';

const count = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(4_000_000));
const Doc = v.looseObject({ nodes: v.array(v.object({ name: v.optional(v.string()) })), accessors: v.array(v.unknown()),
  animations: v.array(v.object({ name: v.string(), channels: v.array(v.object({ sampler: count, target: v.object({ node: count, path: v.picklist(['translation', 'rotation', 'scale']) }) })),
    samplers: v.array(v.object({ input: count, output: count, interpolation: v.optional(v.picklist(['LINEAR', 'STEP']), 'LINEAR') })) })) });
const Accessor = v.object({ bufferView: count, byteOffset: v.optional(count, 0), componentType: v.literal(5126), type: v.picklist(['SCALAR', 'VEC3', 'VEC4']), count });
const View = v.object({ byteOffset: v.optional(count, 0), byteStride: v.optional(count), byteLength: count });
interface Track { readonly joint: number; readonly property: 'position' | 'quaternion' | 'scale'; readonly sample: (time: number) => ArrayLike<number> }
interface Clip { readonly duration: number; readonly tracks: readonly Track[] }

/** Same quaternion primitive as Three's clip interpolant; STEP retains the previous key. */
function sampleTrack(times: Float32Array, values: Float32Array, width: number, rotation: boolean, step: boolean): Track['sample'] {
  const result = ownedArray(Float32Array, width, { owner: 'creature clip sampler', asset: 'sample result', kind: 'scratch' });
  if (!rotation && !step) {
    const interpolant = new LinearInterpolant(times, values, width, result);
    return time => interpolant.evaluate(time);
  }
  const quaternionResult = [0, 0, 0, 1];
  const quaternionValues = rotation ? Array.from(values) : [];
  return time => {
    let low = 0, high = times.length;
    while (low < high) { const mid = (low + high) >>> 1; if ((times[mid] ?? Infinity) <= time) low = mid + 1; else high = mid; }
    const start = Math.max(0, low - 1), end = Math.min(times.length - 1, low), first = times[start] ?? 0, last = times[end] ?? first;
    if (step || start === end || time <= first) { for (let field = 0; field < width; field++) result[field] = values[start * width + field] ?? 0; }
    else { Quaternion.slerpFlat(quaternionResult, 0, quaternionValues, start * width, quaternionValues, end * width, (time - first) / (last - first)); result.set(quaternionResult); }
    return result;
  };
}

/** Only giant opt-in admission constructs this numeric track bank. Existing defining
 * GLB validation and meshopt decoding bound every reference before a track is allocated. */
export class CreatureClipSampler {
  private readonly clips = new Map<string, Clip>();
  private readonly locals: { position: Vector3; quaternion: Quaternion; scale: Vector3 }[];
  private readonly frame = new Matrix4();
  readonly pose: CollisionPose;
  private readonly joints: readonly CreatureRestJoint[];
  constructor(bytes: Uint8Array, joints: readonly CreatureRestJoint[]) {
    this.joints = joints;
    parseGlbData(bytes);
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
    const doc = v.parse(Doc, JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))));
    const data = glbBuffers(doc, bytes.subarray(28 + length)), binary = new DataView(data.bytes.buffer, data.bytes.byteOffset, data.bytes.byteLength);
    const read = (index: number, width: number): Float32Array => {
      const accessor = v.parse(Accessor, doc.accessors[index]), view = v.parse(View, data.views[accessor.bufferView]);
      if (accessor.type !== (width === 1 ? 'SCALAR' : width === 4 ? 'VEC4' : 'VEC3')) throw new Error('Invalid creature clip accessor');
      const stride = view.byteStride ?? width * 4;
      if (stride < width * 4 || accessor.byteOffset + (accessor.count - 1) * stride + width * 4 > view.byteLength) throw new Error('Invalid creature clip buffer');
      const values = ownedArray(Float32Array, accessor.count * width, { owner: 'creature clip sampler', asset: 'keyframe track', kind: 'decode' });
      for (let row = 0; row < accessor.count; row++) for (let field = 0; field < width; field++) values[row * width + field] = binary.getFloat32(view.byteOffset + accessor.byteOffset + row * stride + field * 4, true);
      return values;
    };
    for (const animation of doc.animations) {
      if (this.clips.has(animation.name)) throw new Error(`Ambiguous creature clip ${animation.name}`);
      let duration = 0;
      const tracks = animation.channels.map(channel => {
        const name = doc.nodes[channel.target.node]?.name, joint = joints.findIndex(row => row.name === name), sampler = animation.samplers[channel.sampler];
        if (joint === -1 || sampler === undefined) throw new Error(`Creature clip needs a named skin joint: ${name ?? channel.target.node}`);
        const width = channel.target.path === 'rotation' ? 4 : 3, times = read(sampler.input, 1), values = read(sampler.output, width);
        duration = Math.max(duration, times[times.length - 1] ?? 0);
        const property: Track['property'] = channel.target.path === 'translation' ? 'position' : channel.target.path === 'rotation' ? 'quaternion' : 'scale';
        return { joint, property, sample: sampleTrack(times, values, width, property === 'quaternion', sampler.interpolation === 'STEP') };
      });
      if (duration <= 0) throw new Error('Creature clip needs a positive duration');
      this.clips.set(animation.name, { duration, tracks });
    }
    this.pose = new CollisionPose(joints);
    this.locals = joints.map(() => ({ position: new Vector3(), quaternion: new Quaternion(), scale: new Vector3(1, 1, 1) }));
  }
  has(name: string): boolean { return this.clips.has(name); }
  point(index: number, at: readonly [number, number, number], out: Vector3): Vector3 { return this.pose.point(index, at, out); }
  duration(name: string): number { const clip = this.clips.get(name); if (clip === undefined) throw new Error(`Missing creature clip ${name}`); return clip.duration; }
  joint(name: string, position: Vector3, quaternion: Quaternion, scale: Vector3): boolean {
    const index = this.joints.findIndex(row => row.name === name), local = this.locals[index];
    if (local === undefined) return false;
    position.copy(local.position); quaternion.copy(local.quaternion); scale.copy(local.scale); return true;
  }
  /** Reading a frame never advances a clock. Untracked components reset to rest on every sample. */
  sample(name: string, time: number, loop: boolean): CollisionPose {
    const clip = this.clips.get(name);
    if (clip === undefined || !Number.isFinite(time) || time < 0) throw new Error('Invalid creature clip frame');
    const at = loop ? time % clip.duration : Math.min(time, clip.duration);
    this.joints.forEach((joint, index) => { const local = this.locals[index]; if (local === undefined) throw new Error('Missing creature clip joint');
      local.position.fromArray(joint.position); local.quaternion.identity(); local.scale.fromArray(joint.scale ?? [1, 1, 1]); });
    for (const track of clip.tracks) { const local = this.locals[track.joint]; if (local === undefined) throw new Error('Missing creature track joint'); local[track.property].fromArray(track.sample(at)); }
    this.locals.forEach((local, index) => this.pose.setQuaternion(index, local.position, local.quaternion, local.scale));
    this.pose.solve(this.frame); return this.pose;
  }
}

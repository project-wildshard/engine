import { Euler, Quaternion, type Bone, type SkinnedMesh } from 'three';
import { validateSkinLayers, type SkinPoseLayer } from '@wildshard/format/skinLayers';

interface CompiledTrack { bone: string; property: SkinPoseLayer['tracks'][number]['property']; axis: 'x' | 'y' | 'z'; order: SkinPoseLayer['tracks'][number]['order']; values: Float32Array }
/** A skin's pose layers compiled to float buffers once; every instance of the skin binds the same buffers to its own bones. */
export interface CompiledSkinPoseLayers { readonly layers: readonly { period: number; times: readonly number[]; phasePeriod: number; phaseSteps: number; tracks: readonly CompiledTrack[] }[] }

/** Validate and compile layer tables against the skin's joint names (no bones yet: the buffers are shared). */
export function compileSkinPoseLayers(layers: readonly SkinPoseLayer[], joints: readonly string[]): CompiledSkinPoseLayers {
  validateSkinLayers(layers, joints);
  return { layers: layers.map((layer) => ({ period: layer.period, times: layer.times, phasePeriod: layer.phasePeriod, phaseSteps: layer.phaseSteps,
    tracks: layer.tracks.map((t) => ({ bone: t.bone, property: t.property, axis: t.axis, order: t.order, values: Float32Array.from(t.values) })) })) };
}

const a = new Quaternion(), b = new Quaternion(), c = new Quaternion(), d = new Quaternion(), euler = new Euler();
/** Bind compiled layers to one skeleton; cached base poses prevent AnimationMixer's constant-track optimisation accumulating deltas. */
export function bindSkinPoseLayers(compiled: CompiledSkinPoseLayers, bones: readonly Bone[]): { restore: () => void; apply: (time: number) => void } {
  const base = bones.map((bone) => ({ p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() }));
  const layers = compiled.layers.map((layer) => ({ ...layer, tracks: layer.tracks.map((t) => {
    const bone = bones.find((candidate) => candidate.name === t.bone); if (bone === undefined) throw new Error('Missing skin layer bone');
    return { ...t, bone };
  }) }));
  return {
    restore: () => { for (let i = 0; i < bones.length; i++) { const bone = bones[i], pose = base[i]; if (bone !== undefined && pose !== undefined) { bone.position.copy(pose.p); bone.quaternion.copy(pose.q); bone.scale.copy(pose.s); } } },
    apply: (time) => {
      if (!Number.isFinite(time) || time < 0) throw new Error('Invalid skin layer clock');
      // index loops, not forEach: a frame's apply makes no closure (D2 idle heap churn)
      for (let i = 0; i < bones.length; i++) { const bone = bones[i], pose = base[i]; if (bone !== undefined && pose !== undefined) { pose.p.copy(bone.position); pose.q.copy(bone.quaternion); pose.s.copy(bone.scale); } }
      for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        const layer = layers[layerIndex]; if (layer === undefined) continue;
        const t = time % layer.period, times = layer.times; let lo = 0, hi = times.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((times[mid] ?? 0) > t) hi = mid; else lo = mid; }
        const blend = (t - (times[lo] ?? 0)) / ((times[hi] ?? layer.period) - (times[lo] ?? 0));
        const phase = (time % layer.phasePeriod) / layer.phasePeriod * layer.phaseSteps, p = Math.floor(phase), fraction = phase - p, stride = layer.phaseSteps + 1;
        for (let trackIndex = 0; trackIndex < layer.tracks.length; trackIndex++) {
          const track = layer.tracks[trackIndex]; if (track === undefined) continue;
          const values = track.values, bone = track.bone;
          if (track.property === 'quaternion') {
            a.fromArray(values, (lo * stride + p) * 4); b.fromArray(values, (hi * stride + p) * 4); a.slerp(b, blend);
            if (layer.phaseSteps > 0) { c.fromArray(values, (lo * stride + p + 1) * 4); d.fromArray(values, (hi * stride + p + 1) * 4); c.slerp(d, blend); a.slerp(c, fraction); }
            bone.quaternion.multiply(a).normalize();
          } else {
            const value = (values[lo] ?? 0) + ((values[hi] ?? 0) - (values[lo] ?? 0)) * blend;
            if (track.property === 'rotation') {
              euler.setFromQuaternion(bone.quaternion, track.order);
              if (track.axis === 'x') euler.x += value;
              else if (track.axis === 'y') euler.y += value;
              else euler.z += value;
              bone.quaternion.setFromEuler(euler);
            } else {
              const target = bone[track.property];
              if (track.axis === 'x') target.x += value;
              else if (track.axis === 'y') target.y += value;
              else target.z += value;
            }
          }
        }
      }
    },
  };
}

/** Compile and bind in one step for a single skinned mesh (the SF9c player). */
export function skinPoseLayers(mesh: SkinnedMesh, layers: readonly SkinPoseLayer[]): { restore: () => void; apply: (time: number) => void } {
  const bones = mesh.skeleton.bones;
  return bindSkinPoseLayers(compileSkinPoseLayers(layers, bones.map((bone) => bone.name)), bones);
}

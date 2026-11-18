import type { MemoryLabel } from '../../../shared/engine/core/memoryAttribution';
import { ownedArray } from '../../../shared/engine/core/ownedBuffer';
import { observeAudioMemory } from '../../../shared/engine/core/memoryResources';
import type { SampleClip } from './Cues';

const PCM_SCALE = 32768;

/** Only a playing take needs a native float buffer. Weak reuse shares simultaneous starts
 * without letting the catalogue retain PCM after the last source releases it. */
export function packMonoCue(clip: SampleClip, label: MemoryLabel): SampleClip {
  const { buffer, offset, duration, gain } = clip, { sampleRate } = buffer;
  // Keep one neighbor on either side for native interpolation at a fractional cut.
  const start = Math.min(buffer.length - 1, Math.max(0, Math.floor(offset * sampleRate) - 1));
  const localOffset = Math.max(0, offset - start / sampleRate);
  const length = Math.min(buffer.length - start, Math.ceil((localOffset + duration) * sampleRate) + 1);
  const pcm = ownedArray(Int16Array, length, { owner: label.owner, ...(label.asset === undefined ? {} : { asset: label.asset }), kind: 'audio-data' });
  const source = buffer.getChannelData(0);
  let peak = 1;
  for (let frame = 0; frame < length; frame++) peak = Math.max(peak, Math.abs(source[start + frame] ?? 0));
  const unit = Math.ceil(peak) / PCM_SCALE;
  for (let frame = 0; frame < length; frame++) {
    const sample = Math.round((source[start + frame] ?? 0) / unit);
    pcm[frame] = Math.max(-PCM_SCALE, Math.min(PCM_SCALE - 1, sample));
  }
  const materialize = cueBuffer(pcm, sampleRate, unit, label);
  return { get buffer() { return materialize(); }, offset: localOffset, duration, gain };
}

/** Families can refer to the same take with different gains. Retain its samples once. */
export function packCueClips(
  families: ReadonlyMap<string, SampleClip[]>, into: Map<string, SampleClip[]>, asset: string,
): void {
  const label = { owner: 'audio:cue-sprite', asset: `audio${asset}` };
  const takes = new Map<string, SampleClip>();
  for (const [family, clips] of families) {
    into.set(family, clips.map(clip => {
      const key = `${clip.offset}/${clip.duration}`;
      const cached = takes.get(key);
      if (cached) return cueGain(cached, clip.gain);
      const packed = packMonoCue(clip, label);
      takes.set(key, packed);
      return packed;
    }));
  }
}

export function cueGain(clip: SampleClip, gain: number): SampleClip {
  if (clip.gain === gain) return clip;
  return { get buffer() { return clip.buffer; }, offset: clip.offset, duration: clip.duration, gain };
}

function cueBuffer(pcm: Int16Array, sampleRate: number, unit: number, label: MemoryLabel): () => AudioBuffer {
  let previous: WeakRef<AudioBuffer> | undefined;
  return () => {
    const old = previous?.deref();
    if (old) return old;
    const buffer = new AudioBuffer({ length: pcm.length, numberOfChannels: 1, sampleRate });
    const channel = buffer.getChannelData(0);
    for (let frame = 0; frame < pcm.length; frame++) channel[frame] = (pcm[frame] ?? 0) * unit;
    previous = new WeakRef(buffer);
    return observeAudioMemory(buffer, label);
  };
}

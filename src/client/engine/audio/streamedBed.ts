import { indexRecordingAac } from '@wildshard/format/aacIndex';
import { observeAudioMemory } from '../../../shared/engine/core/memoryResources';
import { adoptBuffer } from '../../../shared/engine/core/ownedBuffer';
import { audioTimeout } from './activityTimers';
import { AacSource } from './aacSource';
import { AacTrack } from './aacTrack';
import { playSampleLoop, type LoopStart, type LoopVoice } from './sampleLoop';
import type { SampleLoop } from './Audio';

const RATE = 48000;
const BED_PREFILL_FRAMES = RATE * 2;

interface Recording {
  bytes: ArrayBuffer;
  url: string;
  start: number;
  end: number;
  gain: number;
  halfRate?: boolean;
  decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
}

/** Whole-file loops can use the media element's native loop. Authored
 * subranges need a sample-clock loop, with the same start and end frames. */
export async function streamedBed(recording: Recording): Promise<SampleLoop | undefined> {
  const { bytes, start, end, gain } = recording;
  if (end - start < 4) return undefined;
  const encoded = adoptBuffer(new Uint8Array(bytes, 0), { owner: 'engine/audio', asset: `audio-wire${recording.url}`, kind: 'audio-data' });
  const first = start * RATE, last = end * RATE;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 0) return undefined;
  let whole = false, channels: number;
  try {
    const index = indexRecordingAac(encoded);
    channels = index.channels;
    whole = recording.halfRate !== true && first === 0 && last === index.sizes.length * 1024 - index.primingFrames;
  } catch { return undefined; }
  const track = whole ? undefined : await AacTrack.open(encoded, start, end, recording.decode, undefined, undefined, frames =>
    observeAudioMemory(new AudioBuffer({ length: frames, numberOfChannels: channels, sampleRate: RATE }),
      { owner: 'engine/audio', asset: `audio-stream${recording.url}` }), BED_PREFILL_FRAMES,
    recording.halfRate === true ? copyHalfRate : undefined);
  if (!whole && track === undefined) return undefined;
  return { loopStart: start, loopEnd: end, gain, stream: {
    start: ports => play(recording, ports, track?.fork(), whole),
  } };
}

/** Match the previous phone bed's 24 kHz bandwidth and linear playback
 * interpolation while retaining the AAC scheduler's 48 kHz sample clock.
 * Source-frame parity stays fixed across AAC windows, and their existing
 * interpolation guards cover the symmetric low-pass taps. */
function copyHalfRate(buffer: AudioBuffer, pcm: readonly Float32Array[], destination: number, start: number): void {
  pcm.forEach((channel, index) => {
    const output = buffer.getChannelData(index);
    const at = (i: number): number => channel[Math.max(0, Math.min(channel.length - 1, i))] ?? 0;
    const filtered = (i: number): number => 0.4 * at(i) + 0.35 * (at(i - 1) + at(i + 1)) - 0.05 * (at(i - 3) + at(i + 3));
    const first = start % 2 === 0 ? 0 : -1;
    let previous = filtered(first);
    for (let frame = first; frame < channel.length; frame += 2) {
      if (frame >= 0) output[destination + frame] = previous;
      const next = filtered(frame + 2);
      if (frame + 1 < channel.length) output[destination + frame + 1] = (previous + next) / 2;
      previous = next;
    }
  });
}

function play(recording: Recording, ports: LoopStart, track: AacTrack | undefined, whole: boolean): LoopVoice {
  const { context, output, owner, offset, time, ended } = ports;
  const voice = owner.child('sampled-bed');
  let native: AacSource | undefined;
  let fallback: LoopVoice | undefined;
  let loadingFallback = false;
  let stopAt = Infinity;
  let startTime = Math.max(time, context.currentTime);
  voice.onDispose(ended);
  const live = (): boolean => !voice.disposed && !voice.disposing && context.currentTime < stopAt;
  const recover = async (): Promise<void> => {
    if (!live() || loadingFallback) return;
    loadingFallback = true;
    try {
      const buffer = await recording.decode(recording.bytes.slice(0));
      if (!live()) return;
      const { start, end, gain } = recording;
      const span = end - start;
      const phase = start + (offset - start + Math.max(0, context.currentTime - startTime)) % span;
      fallback = playSampleLoop({ buffer, loopStart: start, loopEnd: end, gain },
        { ...ports, owner: voice, time: startTime, offset: phase, ended: () => { voice.dispose(); } });
      if (Number.isFinite(stopAt)) fallback.stop(stopAt);
    } catch { voice.dispose(); }
  };
  const open = async (): Promise<void> => {
    try {
      if (whole && 'createMediaElementSource' in context && context instanceof AudioContext) {
        const mediaOwner = voice.child('media-bed');
        try {
          await playMedia(recording, ports, context, mediaOwner, live);
          return;
        } catch {
          mediaOwner.dispose();
        }
      }
      if (!track || context.sampleRate !== RATE) { await recover(); return; }
      const initial = Math.min(track.loopEnd - 1, Math.max(track.loopStart, Math.round(offset * RATE)));
      await track.primeAt(initial, voice);
      if (!live()) return;
      startTime = Math.max(time, context.currentTime + 0.04);
      native = new AacSource(track, { context, output, scope: voice, failed: () => { void recover(); },
        ended: () => { voice.dispose(); } }, startTime, { initial, at: startTime });
      if (Number.isFinite(stopAt)) native.stop(stopAt);
    } catch { await recover(); }
  };
  void open();
  return { stop: (at = context.currentTime) => {
    if (voice.disposed || voice.disposing) return;
    if (at <= context.currentTime) { voice.dispose(); return; }
    stopAt = at;
    native?.stop(at); fallback?.stop(at);
    audioTimeout(voice, context, (at - context.currentTime) * 1000, () => { voice.dispose(); });
  } };
}

async function playMedia(recording: Recording, ports: LoopStart, context: AudioContext, owner: LoopStart['owner'],
  live: () => boolean): Promise<void> {
  const element = new Audio();
  const url = URL.createObjectURL(new Blob([recording.bytes], { type: 'audio/mp4' }));
  owner.onDispose(() => { element.pause(); element.removeAttribute('src'); element.load(); URL.revokeObjectURL(url); });
  const source = context.createMediaElementSource(element);
  owner.onDispose(() => {
    source.disconnect();
  });
  element.preload = 'auto'; element.loop = true;
  const loaded = new Promise<boolean>(resolve => {
    owner.onDispose(() => { resolve(false); });
    owner.listen(element, 'loadedmetadata', () => { resolve(true); }, { once: true });
    owner.listen(element, 'error', () => { resolve(false); }, { once: true });
    owner.timeout(2500, () => { resolve(false); });
  });
  element.src = url;
  if (!await loaded || !live()) throw new Error('Media bed could not load');
  element.currentTime = ports.offset;
  source.connect(ports.output);
  await element.play();
  if (context.state !== 'running') element.pause();
  owner.listen(context, 'statechange', () => {
    if (context.state === 'running') void element.play().catch(() => undefined);
    else element.pause();
  });
}

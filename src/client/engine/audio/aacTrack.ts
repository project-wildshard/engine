import { indexRecordingAac, type RecordingAacIndex } from '@wildshard/format/aacIndex';
import { AacPull, type AacCodecFactory } from './aacPull';
import { nativeAacFactory } from './aacNative';
import { AacWindows, aacWindowEligible, type AacWindow } from './aacWindows';
import { Scope } from '../../../shared/engine/app/scope';
import { observeAudioMemory } from '../../../shared/engine/core/memoryResources';
import { currentOwner } from '../../../shared/engine/app/ownership';

/** Ten seconds protect the native sources from multi-second main-thread installs without whole-track PCM. */
export const AAC_PREFILL_FRAMES = 480000;
export interface AacPreparedWindow { readonly plan: AacWindow; readonly buffer: AudioBuffer }
export type AacBufferFactory = (frames: number, channels: 1 | 2) => AudioBuffer;
/** Encoded track plus a transferable bounded prebuffer; never a whole decoded recording. */
export class AacTrack {
  readonly duration: number;
  readonly sampleRate = 48000;
  readonly loopStart: number;
  readonly loopEnd: number;
  readonly frames: number;
  readonly bytes: Uint8Array;
  readonly index: RecordingAacIndex;
  readonly factory: AacCodecFactory;
  private prepared: readonly AacPreparedWindow[] | undefined;
  private preparedInitial = 0;
  private preparingInitial = 0;
  private preparing: Promise<void> | undefined;
  private fallback: Promise<AudioBuffer> | undefined;
  private readonly decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
  private readonly makeBuffer: AacBufferFactory;
  private constructor(bytes: Uint8Array, index: RecordingAacIndex, factory: AacCodecFactory, loopStart: number, loopEnd: number,
    decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>, makeBuffer: AacBufferFactory) {
    this.bytes = bytes; this.index = index; this.factory = factory; this.loopStart = loopStart; this.loopEnd = loopEnd;
    this.frames = index.sizes.length * 1024 - index.primingFrames; this.duration = this.frames / 48000;
    this.decode = decode; this.makeBuffer = makeBuffer;
  }
  get ready(): boolean { return this.prepared !== undefined && this.preparedInitial === 0; }
  /** Move prebuffer ownership to the playing source, so the bank cannot retain already-ended PCM. */
  take(initial = 0): readonly AacPreparedWindow[] {
    const result = this.prepared;
    if (!result || this.preparedInitial !== initial) throw new Error('AAC prebuffer is not ready at the requested sample');
    this.prepared = undefined;
    return result;
  }
  /** Replay re-primes short windows before the bar handoff; concurrent requests share the same bounded work. */
  prime(owner?: Scope): Promise<void> {
    return this.primeAt(0, owner);
  }
  /** Prepare the same bounded windows at an authored source sample, for a
   * late stem joining its already playing partner without restarting it. */
  primeAt(initial: number, owner?: Scope): Promise<void> {
    if (owner?.disposed || owner?.disposing) return Promise.reject(new Error('AAC preparation owner retired'));
    if (!Number.isSafeInteger(initial) || initial < 0 || initial >= this.loopEnd) return Promise.reject(new Error('Invalid AAC preparation source sample'));
    if (this.prepared && this.preparedInitial === initial) return Promise.resolve();
    if (this.preparing) {
      if (this.preparingInitial === initial) return this.preparing;
      const previous = this.preparing;
      return (async () => { await previous; await this.primeAt(initial, owner); })();
    }
    this.prepared = undefined; this.preparingInitial = initial;
    const work = this.fill(owner, initial).finally(() => { if (this.preparing === work) this.preparing = undefined; });
    this.preparing = work;
    return work;
  }
  private async fill(owner: Scope | undefined, initial: number): Promise<void> {
    const scope = owner?.child('AAC.prepare') ?? new Scope('AAC.prepare');
    const pull = new AacPull(this.bytes, this.index, this.factory, scope), plans = new AacWindows(this.loopStart, this.loopEnd, this.frames, initial);
    const windows: AacPreparedWindow[] = [];
    try {
      for (;;) {
        const plan = plans.next();
        if (plan.timeline >= AAC_PREFILL_FRAMES) break;
        const buffer = this.buffer(plan.frames);
        for (const part of plan.parts) {
          const pcm = await pull.read(part.start, part.frames);
          if (scope.disposed || scope.disposing) throw new Error('AAC preparation owner retired');
          pcm.forEach((channel, i) => { buffer.getChannelData(i).set(channel, part.destination); });
        }
        windows.push({ plan, buffer });
      }
      this.preparedInitial = initial; this.prepared = windows;
    } finally { scope.dispose(); }
  }
  /** Allocate only the admitted channel count; live playback uses the same ownership label as preparation. */
  buffer(frames: number): AudioBuffer { return this.makeBuffer(frames, this.index.channels); }
  /** Original-path fallback for an unsupported live sample rate; concurrent attempts share, failures can retry. */
  decoded(): Promise<AudioBuffer> {
    if (this.fallback) return this.fallback;
    const work = this.decode(this.bytes.slice().buffer);
    this.fallback = work;
    void work.catch(() => { if (this.fallback === work) this.fallback = undefined; });
    return work;
  }
  /** Prepare without opening an audio device. Unsupported native APIs, file layouts
   * return undefined. Short AudioBuffers are context-independent; the injected factory supports headless
   * lifecycle proofs. Successful playback takes their ownership; a later replay primes them again. */
  static async prepare(bytes: Uint8Array, loopStartSeconds: number, loopEndSeconds: number,
    decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>, factory?: AacCodecFactory, owner?: Scope,
    makeBuffer?: AacBufferFactory): Promise<AacTrack | undefined> {
    if (owner?.disposed) return undefined;
    const label = { owner: currentOwner()?.name ?? 'engine/audio', asset: 'audio/aac-windows' };
    const buffers = makeBuffer ?? (typeof AudioBuffer === 'function'
      ? (frames: number, channels: 1 | 2): AudioBuffer => observeAudioMemory(new AudioBuffer({ length: frames, numberOfChannels: channels, sampleRate: 48000 }), label) : undefined);
    if (!buffers) return undefined;
    // Both paired stems round the same authored times, at most half a sample.
    const loopStart = Math.round(loopStartSeconds * 48000), loopEnd = Math.round(loopEndSeconds * 48000);
    let index: RecordingAacIndex;
    try { index = indexRecordingAac(bytes); } catch { return undefined; }
    const frames = index.sizes.length * 1024 - index.primingFrames;
    if (!aacWindowEligible(48000, loopStart, loopEnd, frames)) return undefined;
    const native = factory ?? await nativeAacFactory(index);
    if (!native || owner?.disposed) return undefined;
    const track = new AacTrack(bytes, index, native, loopStart, loopEnd, decode, buffers);
    try { await track.prime(owner); return track; } catch { return undefined; }
  }
}

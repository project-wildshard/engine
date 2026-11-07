import type { RecordingAacIndex } from '@wildshard/format/aacIndex';
import type { Scope } from '../../../shared/engine/app/scope';

/** The small native-codec surface used by the bounded reader; injectable for deterministic lifecycle tests. */
export interface AacOutput {
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  copyTo: (destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }) => void;
  close: () => void;
}
export interface AacCodec {
  decode: (packet: { data: Uint8Array; timestamp: number }) => void;
  flush: () => Promise<void>;
  close: () => void;
}
export type AacCodecFactory = (output: (data: AacOutput) => void, error: (error: unknown) => void) => AacCodec;
type Channels = readonly Float32Array[];
interface Chunk { readonly channels: Channels; at: number }
const BATCH = 8, PACKET_FRAMES = 1024, HISTORY = 64;
/** Maximum one pull: half a second at 48 kHz plus both 32-frame interpolation guards. */
export const AAC_WINDOW_FRAMES = 24064;

/** Pull exact native PCM into bounded short windows, never a whole-file AudioBuffer.
 * At most eight AAC packets are in flight; their AudioData are copied and closed immediately.
 * Flush happens only at end-of-stream: flushing intermediate AAC batches changes native filter state.
 * Sequential pulls may overlap by 64 frames. A backwards seek replays compressed packets from the
 * beginning so codec filter state remains identical to the whole-file decoder, rather than guessing preroll.
 * The owner must serialize pulls; disposal closes the codec and invalidates pending work.
 */
export class AacPull {
  private bytes: Uint8Array | undefined;
  private codec: AacCodec | undefined;
  private failure: unknown;
  private failed = false;
  private busy = false;
  private disposed = false;
  private generation = 0;
  private wake: (() => void) | undefined;
  private flushed = false;
  private packet = 0;
  private outputFrames = 0;
  private cursor = 0;
  private queuedFrames = 0;
  private chunks: Chunk[] = [];
  private history: Channels;
  private historyFrames = 0;
  private highWaterFrames = HISTORY;
  private readonly removeOwner: () => void;
  private readonly index: RecordingAacIndex;
  private readonly factory: AacCodecFactory;
  constructor(bytes: Uint8Array, index: RecordingAacIndex, factory: AacCodecFactory, scope: Scope) {
    if (scope.disposed) throw new Error('AAC owner has retired');
    this.bytes = bytes; this.index = index; this.factory = factory;
    this.history = Array.from({ length: index.channels }, () => new Float32Array(HISTORY));
    this.removeOwner = scope.capture('disposers', () => this.dispose());
  }
  /** Current bounded decoder queue, excluding the caller-owned returned short window. */
  get retainedFrames(): number { return this.chunks.length * PACKET_FRAMES + (this.history[0]?.length ?? 0); }
  /** High-water PCM frames retained by the decoder queue/history; excludes caller-owned windows. */
  get peakRetainedFrames(): number { return this.highWaterFrames; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++; this.wake?.(); this.wake = undefined; this.codec?.close(); this.codec = undefined;
    this.bytes = undefined; this.failure = undefined; this.chunks = []; this.queuedFrames = 0; this.historyFrames = 0;
    this.history = []; this.removeOwner();
  }
  private live(): void {
    if (this.disposed) throw new Error('AAC owner has retired');
    if (this.failed) throw this.failure;
  }
  private reset(): void {
    this.generation++; this.codec?.close(); this.codec = undefined; this.packet = 0; this.outputFrames = 0;
    this.flushed = false; this.cursor = 0; this.queuedFrames = 0; this.chunks = []; this.historyFrames = 0;
    const generation = this.generation;
    this.codec = this.factory(data => {
      try {
        if (this.disposed || generation !== this.generation) return;
        if (data.numberOfFrames !== PACKET_FRAMES || data.numberOfChannels !== this.index.channels || data.sampleRate !== 48000
          || this.queuedFrames + data.numberOfFrames > BATCH * PACKET_FRAMES
          || this.outputFrames + data.numberOfFrames > this.index.sizes.length * PACKET_FRAMES) {
          throw new Error('AAC output exceeds the admitted packet bounds');
        }
        const skip = Math.min(PACKET_FRAMES, Math.max(0, this.index.primingFrames - this.outputFrames));
        this.outputFrames += data.numberOfFrames;
        if (skip === PACKET_FRAMES) return;
        const channels = Array.from({ length: this.index.channels }, (_, planeIndex) => {
          const channel = new Float32Array(PACKET_FRAMES);
          data.copyTo(channel, { planeIndex, format: 'f32-planar' }); return channel;
        });
        this.chunks.push({ channels, at: skip }); this.queuedFrames += PACKET_FRAMES - skip;
        this.highWaterFrames = Math.max(this.highWaterFrames, this.retainedFrames);
      } catch (error) { this.failed = true; this.failure = error; }
      finally { data.close(); if (generation === this.generation) { this.wake?.(); this.wake = undefined; } }
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Native codec errors are push notifications, not Promise completions.
    }, error => { if (!this.disposed && generation === this.generation) { this.failed = true; this.failure = error; this.wake?.(); this.wake = undefined; } });
  }
  private async fill(): Promise<void> {
    this.live();
    if (this.queuedFrames > 0) return;
    const bytes = this.bytes;
    if (!bytes) throw new Error('AAC owner has retired');
    if (!this.codec) this.reset();
    const codec = this.codec;
    if (!codec) throw new Error('AAC codec unavailable');
    const complete = new Promise<void>(resolve => { this.wake = resolve; });
    const inFlight = this.packet - this.outputFrames / PACKET_FRAMES;
    const end = Math.min(this.packet + BATCH - inFlight, this.index.sizes.length);
    for (; this.packet < end; this.packet++) {
      const offset = this.index.offsets[this.packet], size = this.index.sizes[this.packet];
      if (offset === undefined || size === undefined || size <= 0 || offset + size > bytes.length) throw new Error('AAC packet outside admitted bytes');
      codec.decode({ data: bytes.subarray(offset, offset + size), timestamp: Math.round((this.packet * PACKET_FRAMES - this.index.primingFrames) / 48000 * 1e6) });
    }
    if (this.packet === this.index.sizes.length && !this.flushed) {
      this.flushed = true; await codec.flush(); this.live();
    }
    if (this.queuedFrames > 0) return;
    if (this.outputFrames === this.index.sizes.length * PACKET_FRAMES) throw new Error('AAC stream ended before the requested window');
    await complete; this.live();
    if (this.queuedFrames === 0) return this.fill(); // A priming-only output may precede presented samples.
  }

  private consume(limit: number, into: Channels | undefined, at: number): number {
    const chunk = this.chunks[0];
    if (!chunk) throw new Error('AAC output queue empty');
    const count = Math.min(limit, PACKET_FRAMES - chunk.at);
    for (let channel = 0; channel < this.index.channels; channel++) {
      const source = chunk.channels[channel], history = this.history[channel], target = into?.[channel];
      if (!source || !history) throw new Error('AAC channel missing');
      if (target) target.set(source.subarray(chunk.at, chunk.at + count), at);
      const kept = Math.min(HISTORY, count);
      history.copyWithin(0, kept);
      history.set(source.subarray(chunk.at + count - kept, chunk.at + count), HISTORY - kept);
    }
    this.historyFrames = Math.min(HISTORY, this.historyFrames + count);
    chunk.at += count; this.cursor += count; this.queuedFrames -= count;
    if (chunk.at === PACKET_FRAMES) this.chunks.shift();
    return count;
  }
  /** Read source-sample coordinates after the validated priming edit; returned arrays belong to the caller. */
  async read(start: number, frames: number): Promise<Channels> {
    this.live();
    if (this.busy) throw new Error('AAC pulls must be serialized');
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(frames) || frames < 1 || frames > AAC_WINDOW_FRAMES
      || start + frames > this.index.sizes.length * PACKET_FRAMES - this.index.primingFrames) throw new Error('AAC window outside admitted bounds');
    this.busy = true;
    try {
      if (start < this.cursor - this.historyFrames) this.reset();
      while (this.cursor < start) { await this.fill(); this.live(); this.consume(start - this.cursor, undefined, 0); }
      const result = Array.from({ length: this.index.channels }, () => new Float32Array(frames));
      let done = 0;
      if (start < this.cursor) {
        done = Math.min(frames, this.cursor - start);
        for (let channel = 0; channel < this.index.channels; channel++) {
          const source = this.history[channel], target = result[channel];
          if (!source || !target) throw new Error('AAC history channel missing');
          const from = HISTORY - (this.cursor - start); target.set(source.subarray(from, from + done));
        }
      }
      while (done < frames) { await this.fill(); this.live(); done += this.consume(frames - done, result, done); }
      return result;
    } catch (error) {
      this.dispose(); throw error;
    } finally { this.busy = false; }
  }
}

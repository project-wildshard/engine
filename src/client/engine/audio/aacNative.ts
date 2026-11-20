import type { RecordingAacIndex } from '@wildshard/format/aacIndex';
import type { AacCodecFactory, AacOutput } from './aacPull';
import { Scope } from '../../../shared/engine/app/scope';

/** Minimal standard WebCodecs declarations, kept separate from playback policy. */
export interface NativeAacConfig {
  readonly codec: 'mp4a.40.2';
  readonly sampleRate: 48000;
  readonly numberOfChannels: 1 | 2;
  readonly description: Uint8Array;
}
export interface NativeAacPacket { readonly timestamp: number; readonly byteLength: number }
export interface NativeAacDecoder {
  configure: (config: NativeAacConfig) => void;
  decode: (packet: NativeAacPacket) => void;
  flush: () => Promise<void>;
  close: () => void;
}
export interface NativeAacConstructor {
  new (init: { output: (data: AacOutput) => void; error: (error: DOMException) => void }): NativeAacDecoder;
  isConfigSupported: (config: NativeAacConfig) => Promise<{ supported?: boolean }>;
}
export type NativeAacPacketConstructor = new (init: { type: 'key'; timestamp: number; data: Uint8Array }) => NativeAacPacket;

/** K6c: AacPull keeps at most eight packets in flight and waits for their output; it flushes only at the stream's end.
 *  Linux WebKit (GStreamer, the preparation recorder's `wildshard prepare` on ubuntu) says it supports mp4a.40.2 yet
 *  answers nothing before a flush, so a streamed bed waited forever and the bar stalled at "Prepared audio clips 86 / 91"
 *  (Driftwood, v0.1.57). A decoder that answers none of the first packets within the probe window is not native here. */
export const AAC_PROBE_PACKETS = 8, AAC_PROBE_MS = 3000;
const unflushedAnswers = new Map<number, Promise<boolean>>();
/** Test seam: forget the page's probe verdicts. */
export function resetAacProbe(): void { unflushedAnswers.clear(); }
async function answersUnflushed(Decoder: NativeAacConstructor, Packet: NativeAacPacketConstructor, config: NativeAacConfig,
  index: RecordingAacIndex, bytes: Uint8Array): Promise<boolean> {
  let answer: (answered: boolean) => void = () => undefined, decoder: NativeAacDecoder | undefined;
  const answered = new Promise<boolean>(resolve => { answer = resolve; }), probe = new Scope('audio.aac-probe');
  probe.timeout(AAC_PROBE_MS, () => { answer(false); });
  try {
    decoder = new Decoder({ output: data => { data.close(); answer(true); }, error: () => { answer(false); } });
    decoder.configure(config);
    const count = Math.min(AAC_PROBE_PACKETS, index.sizes.length);
    for (let packet = 0; packet < count; packet++) {
      const offset = index.offsets[packet], size = index.sizes[packet];
      if (offset === undefined || size === undefined || size <= 0 || offset + size > bytes.length) return false;
      decoder.decode(new Packet({ type: 'key', timestamp: Math.round((packet * 1024 - index.primingFrames) / 48000 * 1e6), data: bytes.subarray(offset, offset + size) }));
    }
    return await answered;
  } catch { return false; }
  finally { probe.dispose(); try { decoder?.close(); } catch { /* already closed by its error */ } }
}

/** Feature-probe native AAC without creating an AudioContext, fetching or decoding any samples.
 * Unsupported native APIs/configurations return undefined so the existing decoder remains available.
 * Each factory creates its own configured decoder; close is idempotent for pending-flush cancellation.
 */
export async function nativeAacFactory(index: RecordingAacIndex, bytes: Uint8Array): Promise<AacCodecFactory | undefined> {
  if (typeof window === 'undefined') return undefined;
  const Decoder = window.AudioDecoder, Packet = window.EncodedAudioChunk;
  if (typeof Decoder !== 'function' || typeof Packet !== 'function') return undefined;
  const config: NativeAacConfig = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: index.channels, description: index.description };
  try { if ((await Decoder.isConfigSupported(config)).supported !== true) return undefined; }
  catch { return undefined; }
  let answers = unflushedAnswers.get(index.channels);
  if (answers === undefined) { answers = answersUnflushed(Decoder, Packet, config, index, bytes); unflushedAnswers.set(index.channels, answers); }
  if (!await answers) return undefined;
  return (output, error) => {
    const decoder = new Decoder({ output, error });
    try { decoder.configure(config); }
    catch (failure) { decoder.close(); throw failure; }
    let closed = false;
    return {
      decode: packet => { decoder.decode(new Packet({ type: 'key', ...packet })); },
      flush: () => decoder.flush(),
      close: () => { if (!closed) { closed = true; decoder.close(); } },
    };
  };
}

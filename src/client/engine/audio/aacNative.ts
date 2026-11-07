import type { RecordingAacIndex } from '@wildshard/format/aacIndex';
import type { AacCodecFactory, AacOutput } from './aacPull';

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

/** Feature-probe native AAC without creating an AudioContext, fetching or decoding any samples.
 * Unsupported native APIs/configurations return undefined so the existing decoder remains available.
 * Each factory creates its own configured decoder; close is idempotent for pending-flush cancellation.
 */
export async function nativeAacFactory(index: RecordingAacIndex): Promise<AacCodecFactory | undefined> {
  if (typeof window === 'undefined') return undefined;
  const Decoder = window.AudioDecoder, Packet = window.EncodedAudioChunk;
  if (typeof Decoder !== 'function' || typeof Packet !== 'function') return undefined;
  const config: NativeAacConfig = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: index.channels, description: index.description };
  try { if ((await Decoder.isConfigSupported(config)).supported !== true) return undefined; }
  catch { return undefined; }
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

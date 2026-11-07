import type { NativeAacConstructor, NativeAacPacketConstructor } from './aacNative';

declare global {
  interface Window {
    /** Optional native WebCodecs APIs: always feature-tested before use. */
    AudioDecoder?: NativeAacConstructor;
    EncodedAudioChunk?: NativeAacPacketConstructor;
  }
}

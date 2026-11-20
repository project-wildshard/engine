// oxlint-disable-next-line import/no-nodejs-modules -- Reads a shipped AAC recording for the native decoder probe.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { indexRecordingAac } from '@wildshard/format/aacIndex';
import { AAC_PROBE_MS, AAC_PROBE_PACKETS, nativeAacFactory, resetAacProbe } from './aacNative';

// K6c (Driftwood on the v0.1.57 preparation client): Linux WebKit's AudioDecoder says it supports mp4a.40.2 but answers
// no packet before a flush. AacPull keeps eight in flight and waits for one, so every streamed phone bed waited forever
// and the recorder's bar stalled at "Prepared audio clips 86 / 91" on the ubuntu runner (24 decodes, 0 outputs).

const bytes = new Uint8Array(readFileSync('public/assets/music/piano/sting-chunk-1f540734.m4a'));
const index = indexRecordingAac(bytes);
let made = 0, decoded = 0;

function install(answersBeforeFlush: boolean): void {
  class Decoder {
    static isConfigSupported(): Promise<{ supported: boolean }> { return Promise.resolve({ supported: true }); }
    private readonly output: (data: unknown) => void;
    constructor(init: { output: (data: unknown) => void }) { made++; this.output = init.output; }
    configure(): void { /* accepted */ }
    decode(): void {
      decoded++;
      if (answersBeforeFlush) this.output({ numberOfFrames: 1024, numberOfChannels: index.channels, sampleRate: 48000, copyTo: () => undefined, close: () => undefined });
    }
    flush(): Promise<void> { return Promise.resolve(); }
    close(): void { /* idempotent */ }
  }
  class Chunk { readonly init: unknown; constructor(init: unknown) { this.init = init; } }
  // the page's own window, with the two WebCodecs classes this probe reads in front of it
  const page: object = typeof window === 'undefined' ? globalThis : window;
  Reflect.set(globalThis, 'window', Object.assign(Object.create(page) as object, { AudioDecoder: Decoder, EncodedAudioChunk: Chunk }));
}

// setup's own globals (its localStorage among them) stay: only this file's window goes back
const had = Object.getOwnPropertyDescriptor(globalThis, 'window');
beforeEach(() => { made = 0; decoded = 0; resetAacProbe(); vi.useFakeTimers(); });
afterEach(() => {
  vi.useRealTimers();
  if (had === undefined) Reflect.deleteProperty(globalThis, 'window'); else Object.defineProperty(globalThis, 'window', had);
});

it('a decoder that answers no packet before a flush is not native AAC here', async () => {
  install(false);
  const factory = nativeAacFactory(index, bytes);
  await vi.advanceTimersByTimeAsync(AAC_PROBE_MS);
  await expect(factory).resolves.toBeUndefined();
  expect(decoded).toBe(Math.min(AAC_PROBE_PACKETS, index.sizes.length));
});

it('a decoder that answers before a flush stays native, and the page probes it once per channel count', async () => {
  install(true);
  expect(await nativeAacFactory(index, bytes)).toBeTypeOf('function');
  expect(await nativeAacFactory(index, bytes)).toBeTypeOf('function');
  expect(made).toBe(1); // the probe's own decoder; the factories make theirs when a pull starts
});

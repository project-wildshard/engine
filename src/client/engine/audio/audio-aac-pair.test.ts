// oxlint-disable-next-line import/no-nodejs-modules -- Reads the shipped AAC pair for the native preparation fixture.
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { AacTrack } from './aacTrack';
import { indexRecordingAac } from '@wildshard/format/aacIndex';
import { parseManifest } from './Stems';
import type { AacCodecFactory } from './aacPull';
import { Scope } from '../../../shared/engine/app/scope';

class Pcm {
  readonly sampleRate = 48000;
  readonly length: number;
  readonly numberOfChannels: number;
  private readonly channels: Float32Array<ArrayBuffer>[];
  constructor(options: { length: number; numberOfChannels: number }) {
    this.length = options.length; this.numberOfChannels = options.numberOfChannels;
    this.channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
  }
  getChannelData(index: number): Float32Array<ArrayBuffer> {
    const channel = this.channels[index]; if (!channel) throw new Error('Missing channel'); return channel;
  }
}

it('bounds paired stereo/mono preparation on the same rounded loop without whole-file decode', async () => {
  vi.stubGlobal('AudioBuffer', Pcm);
  let closed = 0;
  const raw: unknown = JSON.parse(readFileSync('public/assets/music/piano/music.json', 'utf8'));
  const spec = parseManifest(raw)?.slots['island'];
  if (!spec?.tension) throw new Error('Missing paired island score');
  const prepare = (file: string) => {
    const bytes = new Uint8Array(readFileSync(`public/assets/music/piano/${file}`));
    const channels = indexRecordingAac(bytes).channels;
    let packet = 0;
    const factory: AacCodecFactory = output => ({
      decode: () => { const value = ++packet; output({ numberOfFrames: 1024, numberOfChannels: channels, sampleRate: 48000,
        copyTo: (target, options) => { target.fill(value + options.planeIndex); }, close: () => { closed++; } }); },
      flush: () => Promise.resolve(), close: () => { /* Owned decoder ends at preparation. */ },
    });
    return AacTrack.prepare(bytes, spec.loopStart, spec.loopEnd, () => { throw new Error('Unexpected full decode'); }, factory);
  };
  try {
    const [calm, tension] = await Promise.all([prepare(spec.calm), prepare(spec.tension)]);
    if (!calm || !tension) throw new Error('Pair preparation failed');
    expect(calm.index.channels).toBe(2); expect(tension.index.channels).toBe(1);
    expect(calm.loopStart).toBe(tension.loopStart); expect(calm.loopEnd).toBe(tension.loopEnd);
    expect(Math.abs(calm.loopEnd - spec.loopEnd * 48000)).toBeLessThanOrEqual(.5);
    const left = calm.take(), right = tension.take();
    expect(left.map(window => window.plan)).toEqual(right.map(window => window.plan));
    for (const window of right) expect(window.buffer.numberOfChannels).toBe(1);
    const bytes = [...left, ...right].reduce((sum, window) => sum + window.buffer.length * window.buffer.numberOfChannels * 4, 0);
    expect(bytes).toBeLessThan(6000000); expect(closed).toBeGreaterThan(0);
    expect(calm.ready).toBe(false); expect(tension.ready).toBe(false);
    const phase = tension.loopEnd - 2000;
    await tension.primeAt(phase);
    expect(tension.ready).toBe(false);
    expect(() => tension.take()).toThrow('requested sample');
    const joined = tension.take(phase);
    expect(joined[0]?.plan.loop).toBeDefined();
    expect(joined.reduce((sum, window) => sum + window.buffer.length * window.buffer.numberOfChannels * 4, 0)).toBeLessThan(3000000);
    expect(joined.map(window => window.plan)).not.toEqual(right.map(window => window.plan));
    const owner = new Scope('late-pair-owner');
    const pending = tension.primeAt(0, owner);
    owner.onDispose(() => { /* Hold sliced retirement before its decoder child. */ });
    const retirement = owner.disposeSteps();
    try {
      expect(retirement.next().done).toBe(false);
      await expect(pending).rejects.toThrow('AAC preparation owner retired');
      expect(tension.ready).toBe(false);
    } finally { for (const _step of retirement) { /* Drain the started decoder. */ } }
  } finally { vi.unstubAllGlobals(); }
});

import { expect, it, vi } from 'vitest';
import { compactLoopWindow } from './loopWindow';

class Pcm {
  readonly numberOfChannels = 2;
  readonly sampleRate = 48000;
  readonly channels: Float32Array<ArrayBuffer>[];
  readonly length: number;
  constructor(length: number) { this.length = length; this.channels = [new Float32Array(length), new Float32Array(length)]; }
  getChannelData(channel: number): Float32Array<ArrayBuffer> {
    const data = this.channels[channel]; if (data === undefined) throw new Error('Missing PCM channel'); return data;
  }
  copyToChannel(source: Float32Array<ArrayBuffer>, channel: number): void { this.getChannelData(channel).set(source); }
}

it('owns only the loop window while preserving every channel and repeated sample', () => {
  const original = new Pcm(48000);
  for (let channel = 0; channel < 2; channel++) {
    const pcm = original.getChannelData(channel);
    for (let frame = 0; frame < pcm.length; frame++) pcm[frame] = Math.sin(frame * .173 + channel);
  }
  const packed = compactLoopWindow(original, { loopStart: .25, loopEnd: .75 }, frames => new Pcm(frames));
  expect(packed.buffer).not.toBe(original);
  expect(packed.buffer.length).toBeLessThan(original.length);
  expect(packed.loopEnd - packed.loopStart).toBe(.5);
  for (let channel = 0; channel < 2; channel++) {
    const source = original.getChannelData(channel), target = packed.buffer.getChannelData(channel);
    const offset = Math.round(packed.loopStart * packed.buffer.sampleRate);
    const kept = source.subarray(12000 - 128, 36000 + 128);
    expect(target.every((value, frame) => value === kept[frame])).toBe(true);
    const expected = new Float32Array(72000), actual = new Float32Array(72000);
    for (let frame = 0; frame < 72000; frame++) { expected[frame] = source[12000 + frame % 24000] ?? Number.NaN; actual[frame] = target[offset + frame % 24000] ?? Number.NaN; }
    expect(actual.every((value, frame) => value === expected[frame])).toBe(true);
    expect(target.buffer).not.toBe(source.buffer);
  }
});

it('keeps fractional cuts and already compact recordings on their original intake', () => {
  const original = new Pcm(48000), allocate = (): Pcm => { throw new Error('Unexpected allocation'); };
  expect(compactLoopWindow(original, { loopStart: .00001, loopEnd: .75 }, allocate).buffer).toBe(original);
  expect(compactLoopWindow(original, { loopStart: 0, loopEnd: 1 }, allocate).buffer).toBe(original);
});

it('shares compact decoded content without replacing the full-file decoder entry', async () => {
  vi.stubGlobal('AudioBuffer', class extends Pcm { constructor(options: { length: number }) { super(options.length); } });
  vi.stubGlobal('OfflineAudioContext', class { decodeAudioData(): Promise<Pcm> { return Promise.resolve(new Pcm(48000)); } });
  try {
    const { decodeBytes, compactSampleLoop } = await import('./preload');
    const buffer = await decodeBytes(new Uint8Array([1, 2, 3]).buffer);
    const bounds = { loopStart: .25, loopEnd: .75 };
    const a = compactSampleLoop(buffer, bounds, '/assets/sfx/fixture/loop.m4a');
    const b = compactSampleLoop(buffer, bounds, '/assets/sfx/fixture/loop.m4a');
    expect(a.buffer).toBe(b.buffer);
    expect(a.buffer.length).toBeLessThan(buffer.length);
    expect(await decodeBytes(new Uint8Array([1, 2, 3]).buffer)).toBe(buffer);
    expect(buffer.length).toBe(48000);
  } finally { vi.unstubAllGlobals(); }
});

import { afterEach, expect, it, vi } from 'vitest';
import { packCueClips } from './packedCues';
import type { SampleClip } from './Cues';

class BufferFixture {
  readonly numberOfChannels = 1;
  readonly sampleRate: number;
  readonly length: number;
  readonly pcm: Float32Array;
  constructor({ length, sampleRate }: AudioBufferOptions) {
    this.length = length; this.sampleRate = sampleRate; this.pcm = new Float32Array(length);
  }
  getChannelData(): Float32Array { return this.pcm; }
}

afterEach(() => { vi.unstubAllGlobals(); });

it('shares the selected take and preserves its fractional cue bounds, gain and edge samples', () => {
  vi.stubGlobal('AudioBuffer', BufferFixture);
  const sprite = new AudioBuffer({ length: 24000, numberOfChannels: 1, sampleRate: 24000 });
  const pcm = sprite.getChannelData(0);
  pcm.set([.25, -.5, .125, .75, .375], 95);
  const cue = { buffer: sprite, offset: 96.5 / 24000, duration: 2 / 24000, gain: .4 };
  const output = new Map<string, SampleClip[]>();
  packCueClips(new Map([['a', [cue]], ['b', [{ ...cue, gain: .6 }]]]), output, '/assets/sfx/sprite.m4a');
  const a = output.get('a')?.[0], b = output.get('b')?.[0];
  if (!a || !b) throw new Error('Missing admitted cues');
  expect(a.buffer).toBe(b.buffer);
  expect(a.buffer.length).toBe(5);
  expect(a.buffer.sampleRate).toBe(24000);
  expect(a.offset * 24000).toBeCloseTo(1.5);
  expect(a.duration).toBe(cue.duration);
  expect([a.gain, b.gain]).toEqual([.4, .6]);
  expect(Array.from(a.buffer.getChannelData(0))).toEqual([.25, -.5, .125, .75, .375]);
});

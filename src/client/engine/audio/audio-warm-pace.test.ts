import { expect, test } from 'vitest';
import { AUDIO_WARM_PACE_DEFAULT_MS, audioWarmPace } from './Voices';

test('debug.audioWarmPaceMs: a gap from 0 to 2000 ms wins, anything else keeps 16 ms (DW3)', () => {
  expect(AUDIO_WARM_PACE_DEFAULT_MS).toBe(16);
  expect(audioWarmPace(120)).toBe(120);
  expect(audioWarmPace(0)).toBe(0);
  expect(audioWarmPace(null)).toBe(16);
  expect(audioWarmPace('120')).toBe(16);
  expect(audioWarmPace(-1)).toBe(16);
  expect(audioWarmPace(5000)).toBe(16);
  expect(audioWarmPace(Number.NaN)).toBe(16);
});

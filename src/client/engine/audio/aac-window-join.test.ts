import { expect, test } from 'vitest';
import { AacWindows, trimAacWindow } from './aacWindows';

test('a late join keeps the original guarded PCM and exact ordinary source sample', () => {
  const plan = new AacWindows(48000, 192000, 240000).next(), joined = trimAacWindow(plan, 12000);
  expect(joined.parts).toBe(plan.parts); expect(joined.frames).toBe(plan.frames);
  expect(joined.timeline).toBe(12000); expect(joined.duration).toBe(12000); expect(joined.offset).toBe(12000);
  expect(joined.loop).toBeUndefined();
  for (const invalid of [-1, .5, 24000, Infinity]) expect(() => trimAacWindow(plan, invalid)).toThrow('inside');
});

test('a join after the loop seam starts at the exact loop-head sample without new PCM', () => {
  const plan = new AacWindows(48000, 192000, 240000, 190000).next(), joined = trimAacWindow(plan, 3000);
  const pcm = new Float32Array(plan.frames);
  for (const part of plan.parts) for (let i = 0; i < part.frames; i++) pcm[part.destination + i] = part.start + i;
  expect(joined.parts).toBe(plan.parts); expect(joined.frames).toBe(plan.frames);
  expect(joined.duration).toBe(5000); expect(joined.loop).toEqual(plan.loop);
  for (let i = 0; i < joined.duration; i++) expect(pcm[joined.offset + i]).toBe(49000 + i);
  const before = trimAacWindow(plan, 1000);
  expect(pcm[before.offset]).toBe(191000);
});

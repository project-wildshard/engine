// meta SHARD-SOURCE SS8a: a scene shard page drives the wind clock only when nothing else does
import { afterEach, describe, expect, it } from 'vitest';
import { updateWind, windClockFallback, windUniforms } from './wind';

const start = windUniforms.uWindTime.value;
afterEach(() => { windUniforms.uWindTime.value = start; });

describe('windClockFallback', () => {
  it('drives the clock when nothing else does, after one watching frame', () => {
    const frame = windClockFallback(), t0 = windUniforms.uWindTime.value;
    frame(0.1);
    expect(windUniforms.uWindTime.value).toBe(t0);
    frame(0.1); frame(0.1);
    expect(windUniforms.uWindTime.value).toBeCloseTo(t0 + 0.2, 9);
  });

  it('never runs the clock twice a frame beside another driver, before or after it', () => {
    const before = windClockFallback(), after = windClockFallback();
    before(0.1); after(0.1);
    const t0 = windUniforms.uWindTime.value;
    for (let i = 0; i < 5; i++) { before(0.1); updateWind(0.1); }
    expect(windUniforms.uWindTime.value).toBeCloseTo(t0 + 0.5 + 0.1, 9); // the first frame was before's (no driver yet)
    const t1 = windUniforms.uWindTime.value;
    for (let i = 0; i < 5; i++) { updateWind(0.1); after(0.1); }
    expect(windUniforms.uWindTime.value).toBeCloseTo(t1 + 0.5, 9);
  });

  it('takes the clock back the frame after the other driver stops', () => {
    const frame = windClockFallback();
    frame(0.1); updateWind(0.1); frame(0.1);
    const t0 = windUniforms.uWindTime.value;
    frame(0.1);
    expect(windUniforms.uWindTime.value).toBeCloseTo(t0 + 0.1, 9);
  });
});

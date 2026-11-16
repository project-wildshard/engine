import { expect, test } from 'vitest';
import { bridgeVerdict, proofVerdict } from '../scripts/net-lag-verdict.mjs';

const crossing = { reached: true, under: 0, falls: 0, corrections: 2, forcedFrames: 30, forcedFrameMs: 60, spanSamples: 8, lowest: 5.4 };

test('a bridge correctness run never certifies timing metrics', () => {
  const result = proofVerdict({ b1: { ok: false }, b2: { ok: false }, b3: { ok: false }, b4: bridgeVerdict(crossing) }, 'correctness');
  expect(result).toMatchObject({ ok: true, measurement: 'correctness', checked: ['b4'] });
  for (const key of ['b1', 'b2', 'b3']) expect(result).not.toHaveProperty(key);
});

test('missing or unexercised bridge telemetry cannot pass', () => {
  for (const missing of ['under', 'falls', 'corrections', 'forcedFrames', 'forcedFrameMs', 'spanSamples', 'lowest'] as const) {
    const sample: Partial<typeof crossing> = { ...crossing }; delete sample[missing];
    expect(bridgeVerdict(sample).ok, missing).toBe(false);
  }
  for (const sample of [{ corrections: 0 }, { forcedFrames: 0 }, { forcedFrameMs: 16 }, { falls: 1 }, { under: 1 }, { reached: false }]) {
    expect(bridgeVerdict({ ...crossing, ...sample }).ok).toBe(false);
  }
});

test('timing qualification still requires every requested bar', () => {
  expect(proofVerdict({ b1: { ok: true }, b2: { ok: false }, b3: { ok: true }, b4: bridgeVerdict(crossing) }, 'timing').ok).toBe(false);
  expect(proofVerdict({ b4: bridgeVerdict(crossing), error: 'page failed' }, 'correctness').ok).toBe(false);
  expect(proofVerdict({ b4: bridgeVerdict(crossing), errors: ['uncaught page error'] }, 'correctness').ok).toBe(false);
});

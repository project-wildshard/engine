import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the real pure metric without starting the browser CLI.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the tracked metric against controlled telemetry windows.
import { runInNewContext } from 'node:vm';

interface Sample { sampledAt: number; corrections: number }
const source = readFileSync(new URL('../src/scripts/net-lag-proof.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function footRate('), end = source.indexOf('/** One run:', start);
if (start === -1 || end <= start) throw new Error('The proof must expose its pure foot-window metric');
const metric: unknown = runInNewContext(`${source.slice(start, end)}; footRate`);
if (typeof metric !== 'function') throw new Error('Missing foot-window metric');
const rate = (before: Sample | null, after: Sample | null): unknown => Reflect.apply(metric, undefined, [before, after]);

test('rates use sampled duration including steering, rather than nominal phase length', () => {
  expect(rate({ sampledAt: 1000, corrections: 5 }, { sampledAt: 43400, corrections: 7 }))
    .toMatchObject({ elapsedSeconds: 42.4, perMinute: 120 / 42.4 });
});

test('a valid zero-correction window reports zero', () => {
  expect(rate({ sampledAt: 0, corrections: 3 }, { sampledAt: 40000, corrections: 3 }))
    .toMatchObject({ perMinute: 0 });
});

test('the gate can reject an over-limit rate even when its display would round to two', () => {
  expect(rate({ sampledAt: 0, corrections: 0 }, { sampledAt: 29500, corrections: 1 }))
    .toMatchObject({ perMinute: 60 / 29.5 });
});

test('missing or reset telemetry cannot report a passing correction rate', () => {
  const before = { sampledAt: 1000, corrections: 5 };
  for (const after of [null, { sampledAt: 0, corrections: 5 }, { sampledAt: 1000, corrections: 5 },
    { sampledAt: 41000, corrections: 0 }, { sampledAt: 41000, corrections: Number.NaN }]) {
    expect(() => rate(before, after)).toThrow(/telemetry/u);
  }
});

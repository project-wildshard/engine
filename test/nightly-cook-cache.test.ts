import { expect, test } from 'vitest';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import type { CookIndex } from '../src/cook/game/cookWorker';
import { deterministicCookIndex } from '../src/scripts/cook-cache-model';

type Check = NonNullable<CookIndex['check']>;
function cooked(seconds: number, maxMicros: number, p95Micros: number, samples = 180): CookIndex {
  const performance = { ...legacyDouble<Check['performance']>({
    pass: true,
    scripts: { scripts: { p95Micros, maxMicros, samples }, fuel: { max: 80, p95: 55, samples: 180 } },
  }) };
  return { ...legacyDouble<CookIndex>({
    seconds, keys: ['assets/spawn/parts/example.pack.br'], proof: 'proved',
    check: { slug: 'brasscap-mesa', pass: true, failures: [], proof: { ticks: 180, lanes: 9, steps: 9 }, performance },
  }) };
}

test('FS30 keeps elapsed cook and script timings as observations', () => {
  const warm = cooked(11, 14.824, 4.578);
  const cold = cooked(17, 28.387, 4.478);
  expect(deterministicCookIndex(warm)).toEqual(deterministicCookIndex(cold));
  expect(warm.seconds).toBe(11);
  expect(warm.check?.performance.scripts.scripts).toEqual({ maxMicros: 14.824, p95Micros: 4.578, samples: 180 });
});

test('FS30 still compares every byte identity and deterministic simulation observation', () => {
  const current = cooked(11, 15, 5);
  const stable = deterministicCookIndex(current);
  expect(stable).not.toEqual(deterministicCookIndex({ ...current, keys: ['another-part'] }));
  expect(stable).not.toEqual(deterministicCookIndex(cooked(11, 15, 5, 179)));
  const check = current.check;
  if (check === undefined) throw new Error('Missing simulation check');
  const changedFuel = { ...check.performance.scripts.fuel, max: 81 };
  expect(stable).not.toEqual(deterministicCookIndex({
    ...current, check: { ...check, performance: { ...check.performance, scripts: { ...check.performance.scripts, fuel: changedFuel } } },
  }));
});

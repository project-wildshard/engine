// oxlint-disable-next-line import/no-nodejs-modules -- Read the same recorded weights the sequencer reads.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Specs carry absolute module ids, as Vitest gives them.
import { resolve } from 'node:path';
import type { TestSpecification } from 'vitest/node';
import { expect, test } from 'vitest';
import { PushDurationSequencer } from '../scripts/push-duration-sequencer';
import { CPU_EXCLUSIVE_TESTS } from '../scripts/vitest-ci-files';

const weights = JSON.parse(readFileSync('test/durations.json', 'utf8')) as Record<string, number>;
const spec = (file: string): TestSpecification => ({ moduleId: resolve(file) }) as TestSpecification;
const sorted = async (files: readonly string[]): Promise<string[]> =>
  (await new PushDurationSequencer({} as never).sort(files.map(spec))).map(file => file.moduleId.slice(resolve('.').length + 1));
const lightest = Object.entries(weights).filter(([, seconds]) => seconds < 60).sort(([, a], [, b]) => a - b)[0]?.[0] ?? 'missing';

test('measured files run longest first, the bounded cook worker by its own weight, all-slot proofs last (VB8)', async () => {
  const exclusive = new Set<string>(CPU_EXCLUSIVE_TESTS);
  const inventory = [...exclusive, lightest, 'test/cook-worker.test.ts', 'test/nalati-headless-population.test.ts',
    'test/dedicated-hold-expiry.test.ts'];
  for (const file of inventory) expect(weights[file], file).toBeTypeOf('number');
  const order = await sorted(inventory);
  expect([...order].sort()).toEqual([...inventory].sort());
  expect(new Set(order.slice(-exclusive.size))).toEqual(exclusive);
  const shared = order.slice(0, -exclusive.size), cost = (file: string): number => weights[file] ?? Number.NaN;
  for (const [index, file] of shared.entries()) if (index > 0) expect(cost(shared[index - 1] ?? ''), file).toBeGreaterThanOrEqual(cost(file));
});

test('an unmeasured file is weighted as long, and ties keep path order', async () => {
  expect(await sorted(['test/zz-unmeasured.test.ts', lightest, 'test/aa-unmeasured.test.ts']))
    .toEqual(['test/aa-unmeasured.test.ts', 'test/zz-unmeasured.test.ts', lightest]);
});

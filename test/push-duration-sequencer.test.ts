// oxlint-disable-next-line import/no-nodejs-modules -- Read the same recorded weights the sequencer reads.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Specs carry absolute module ids, as Vitest gives them.
import { resolve } from 'node:path';
import type { TestSpecification } from 'vitest/node';
import { expect, test } from 'vitest';
import { PushDurationSequencer } from '../scripts/push-duration-sequencer';
import { CPU_EXCLUSIVE_TESTS } from '../scripts/vitest-ci-files';

const weights = JSON.parse(readFileSync('test/durations.json', 'utf8')) as Record<string, number>;
const spec = (file: string, isolate = true): TestSpecification => ({ moduleId: resolve(file), project: { config: { isolate } } }) as unknown as TestSpecification;
const sorted = async (files: readonly string[], shared: ReadonlySet<string> = new Set()): Promise<string[]> =>
  (await new PushDurationSequencer({} as never).sort(files.map(file => spec(file, !shared.has(file))))).map(file => file.moduleId.slice(resolve('.').length + 1));
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

test('shared-worker files run as one block after the isolated files and before the all-slot proofs (VB14)', async () => {
  const exclusive = [...CPU_EXCLUSIVE_TESTS], measured = Object.entries(weights).filter(([file]) => !exclusive.includes(file as never)).sort(([, a], [, b]) => b - a);
  const heavy = measured[0]?.[0] ?? 'missing', light = measured.at(-1)?.[0] ?? 'missing', middle = measured[Math.floor(measured.length / 2)]?.[0] ?? 'missing';
  // The heaviest file shares a worker here, so only the rank, not its weight, can put it after the lighter isolated ones.
  const order = await sorted([...exclusive, light, middle, heavy], new Set([heavy, middle]));
  expect(order.slice(0, 3)).toEqual([light, heavy, middle]);
  expect(new Set(order.slice(3))).toEqual(new Set(exclusive));
});

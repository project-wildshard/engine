import { expect, test } from 'vitest';
import { bootWaits } from '@wildshard/engine/boot/waits';
import { spawnViewThenNamed } from './readyFrame';

const deferred = (): { promise: Promise<undefined>; resolve: () => void; reject: (error: Error) => void } => {
  let settle = (_value: undefined): void => undefined, fail = (_error: Error): void => undefined;
  const promise = new Promise<undefined>((resolve, reject) => { settle = resolve; fail = reject; });
  return { promise, resolve: () => { settle(undefined); }, reject: error => { fail(error); } };
};

test('a minimap failure fails the ready frame at once, while the spawn view is still held (sp-x1)', async () => {
  const spawn = deferred(), minimap = deferred(), horizon = deferred();
  const step = spawnViewThenNamed(spawn.promise, [['Minimap', minimap.promise], ['Horizon paintings', horizon.promise]]);
  minimap.reject(new Error('minimap failed'));
  await expect(step).rejects.toThrow('minimap failed');
  // the fence was not released by the failure: it settles on its own
  spawn.resolve(); horizon.resolve();
});

test('the jobs beside the spawn view are named only once it ends, and only while they still run', async () => {
  const spawn = deferred(), minimap = deferred(), horizon = deferred();
  const step = spawnViewThenNamed(spawn.promise, [['Minimap', minimap.promise], ['Horizon paintings', horizon.promise]]);
  const labels = (): string[] => bootWaits().map(wait => wait.label);
  await Promise.resolve();
  expect(labels()).not.toContain('Minimap');
  horizon.resolve(); spawn.resolve();
  await new Promise(resolve => { setTimeout(resolve, 0); });
  expect(labels()).toContain('Minimap');
  minimap.resolve();
  await step;
  expect(labels()).not.toContain('Minimap');
  expect(labels()).not.toContain('Horizon paintings');
});

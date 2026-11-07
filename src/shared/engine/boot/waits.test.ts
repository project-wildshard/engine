import { expect, it } from 'vitest';
import { loadingWaitState } from './loadingWaits';
import { countedWait, loadingStepWaits, WaitRegistry } from './waits';

it('a counted wait names its work, moves with each unit, and ends with it', () => {
  const card = countedWait('Server world', 'files');
  const row = (): string | undefined => [...loadingWaitState().pending.values()].find(wait => wait.label.startsWith('Server world'))?.label;
  expect(row()).toBe('Server world');
  card.add(); card.add();
  expect(row()).toBe('Server world · 2 files');
  card.end();
  expect(row()).toBeUndefined();
});

it('reports duplicate concurrent labels with independent ages and clears settled work', async () => {
  let clock = 0;
  const registry = new WaitRegistry(() => clock);
  const deferred = () => {
    let finish = (_value: number): void => { throw new Error('Uninitialized resolver'); };
    const promise = new Promise<number>(resolve => { finish = resolve; });
    return { promise, resolve: finish };
  };
  const first = deferred(), second = deferred();
  const a = registry.waitFor('Read file', first.promise, 'file');
  clock = 1000;
  const b = registry.waitFor('Read file', second.promise, 'file');
  clock = 2500;
  expect(registry.snapshot().map(row => [row.kind, row.ageMs])).toEqual([['file', 2500], ['file', 1500]]);
  first.resolve(3); expect(await a).toBe(3);
  expect(registry.snapshot()).toHaveLength(1);
  second.resolve(7); expect(await b).toBe(7);
  expect(registry.snapshot()).toEqual([]);
});

it('preserves a rejection and removes its waiting entry', async () => {
  const registry = new WaitRegistry();
  const error = new Error('Worker failed');
  await expect(registry.waitFor('Cache worker', Promise.reject(error), 'worker')).rejects.toBe(error);
  expect(registry.snapshot()).toEqual([]);
});

it('selects the displayed step over older foreign music, then its nested work, without borrowing unrelated waits', async () => {
  const registry = new WaitRegistry();
  let finish = (): void => { throw new Error('Uninitialized resolver'); };
  const work = new Promise<void>(resolve => { finish = resolve; });
  const running = [registry.waitFor('Other music', work, 'file', 'audioFiles'),
    registry.waitFor('Current geometry', work, 'file', 'renderer'),
    registry.waitFor('Current terrain', work, 'file', 'world')];
  expect(loadingStepWaits(registry.snapshot(), 'world', 'renderer').map(wait => wait.label)).toEqual(['Current terrain']);
  expect(loadingStepWaits(registry.snapshot(), 'loadout', 'renderer').map(wait => wait.label)).toEqual(['Current geometry']);
  expect(loadingStepWaits(registry.snapshot(), 'shaders', 'shaders')).toEqual([]);
  expect(loadingStepWaits(registry.snapshot(), 'world', 'world', Symbol('next-attempt'))).toEqual([]);
  finish(); await Promise.all(running);
});

it('keeps overlapping attempts separate even when their stage names match', async () => {
  const registry = new WaitRegistry(), oldOwner = Symbol('old'), owner = Symbol('current');
  let finish = (): void => { throw new Error('Uninitialized resolver'); };
  const work = new Promise<void>(resolve => { finish = resolve; });
  const running = [registry.waitFor('Old geometry', work, 'file', 'world', oldOwner),
    registry.waitFor('Current geometry', work, 'file', 'world', owner),
    registry.waitFor('Old nested read', work, 'file', 'renderer', oldOwner),
    registry.waitFor('Current nested read', work, 'file', 'renderer', owner)];
  expect(loadingStepWaits(registry.snapshot(), 'world', 'renderer', owner).map(row => row.label)).toEqual(['Current geometry']);
  expect(loadingStepWaits(registry.snapshot(), 'loadout', 'renderer', owner).map(row => row.label)).toEqual(['Current nested read']);
  finish(); await Promise.all(running);
});

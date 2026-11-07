import { afterEach, expect, test, vi } from 'vitest';
import { BoxGeometry, Group } from 'three';
import { farRingPorts, type FarPrepared } from './farView';

function deferred<T>() {
  let finish: (value: T) => void = () => { throw new Error('No resolver'); };
  let fail: (error: Error) => void = () => { throw new Error('No rejecter'); };
  const promise = new Promise<T>((resolve, reject) => { finish = resolve; fail = reject; });
  return { promise, resolve: finish, reject: fail };
}
afterEach(() => { vi.restoreAllMocks(); });

test('far fetching distinguishes a file/decode wait from hidden shader preparation', async () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(100), root = new Group();
  const load = deferred<FarPrepared>(), prepare = deferred<undefined>(), done = deferred<FarPrepared | Error>();
  const data: FarPrepared = { geometry: new BoxGeometry(), look: { family: 'pbr', haze: { colour: [1, 1, 1] } } };
  const ports = farRingPorts({ root: () => root, load: () => load.promise, prepare: () => prepare.promise });
  ports.fetch({ instance: 'cell' }, done.resolve);
  clock.mockReturnValue(250);
  expect(ports.waiting()).toEqual([{ instance: 'cell', phase: 'load', ageMs: 150, phaseAgeMs: 150 }]);
  load.resolve(data); await Promise.resolve();
  expect(root.children[0]?.visible).toBe(false);
  clock.mockReturnValue(400);
  expect(ports.waiting()).toEqual([{ instance: 'cell', phase: 'prepare', ageMs: 300, phaseAgeMs: 150 }]);
  prepare.resolve(undefined); expect(await done.promise).toBe(data);
  expect(ports.waiting()).toEqual([]);
  const view = ports.upload({ instance: 'cell' }, data);
  expect(view.mesh).toBe(root.children[0]); expect(view.mesh.visible).toBe(true);
  view.dispose(); expect(root.children).toHaveLength(0);
});

test.each(['load', 'prepare'] as const)('far %s rejection retains the original refusal and clears diagnostics', async phase => {
  const root = new Group(), failure = new Error('original failure'), done = deferred<FarPrepared | Error>();
  const geometry = new BoxGeometry(), dispose = vi.fn(); geometry.addEventListener('dispose', () => { dispose(); });
  const ports = farRingPorts({ root: () => root,
    load: () => phase === 'load' ? Promise.reject(failure) : Promise.resolve({ geometry, look: { family: 'pbr', haze: { colour: [1, 1, 1] } } }),
    prepare: () => Promise.reject(failure) });
  ports.fetch({ instance: 'cell' }, done.resolve);
  expect(await done.promise).toBe(failure); expect(ports.waiting()).toEqual([]);
  expect(root.children).toHaveLength(0);
  expect(dispose).toHaveBeenCalledTimes(phase === 'load' ? 0 : 1);
  if (phase === 'load') geometry.dispose();
});

test('overlapping far requests keep independent wait records for the same cell', async () => {
  const first = deferred<FarPrepared>(), second = deferred<FarPrepared>(), done = deferred<FarPrepared | Error>();
  const failure = new Error('first refused'), load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const ports = farRingPorts({ root: () => new Group(), load });
  ports.fetch({ instance: 'cell' }, done.resolve); ports.fetch({ instance: 'cell' }, () => undefined);
  expect(ports.waiting()).toHaveLength(2);
  first.reject(failure); expect(await done.promise).toBe(failure);
  expect(ports.waiting()).toHaveLength(1);
  second.reject(failure); await Promise.resolve();
  expect(ports.waiting()).toEqual([]);
});

import { expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import type { LookStrategy } from '@wildshard/engine/render/look';
import { prepareRegionalInputs } from './regionalInputs';

function deferred<T>() {
  let finish: (value: T) => void = () => undefined;
  let refuse: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => { finish = resolve; refuse = reject; });
  return { promise, resolve: finish, reject: refuse };
}

test('regional input reads overlap but publish only after navigation and look both finish', async () => {
  const owner = new Scope('regional-inputs'), nav = deferred<null>(), appearance = deferred<LookStrategy>();
  const calls: string[] = [], dispose = vi.fn((): void => undefined), look: LookStrategy = { compose: () => ({}), dispose };
  let settled = false;
  const pending = (async () => {
    try {
      return await prepareRegionalInputs({ look: () => { calls.push('look'); return appearance.promise; } }, owner,
        () => { calls.push('nav'); return nav.promise; });
    } finally { settled = true; }
  })();
  expect(calls).toEqual(['nav', 'look']);
  appearance.resolve(look); await Promise.resolve(); await Promise.resolve();
  expect(settled).toBe(false); expect(dispose).not.toHaveBeenCalled();
  nav.resolve(null);
  try { expect(await pending).toEqual({ navmesh: null, look }); }
  finally { owner.dispose(); }
  expect(dispose).toHaveBeenCalledTimes(1);
});

test('a navigation refusal drains and owns a concurrently loaded look', async () => {
  const owner = new Scope('regional-refusal'), appearance = deferred<LookStrategy>(), dispose = vi.fn((): void => undefined);
  const refused = new Error('Navigation refused');
  let settled = false;
  const pending = (async (): Promise<unknown> => {
    try { await prepareRegionalInputs({ look: () => appearance.promise }, owner, () => Promise.reject(refused)); return null; }
    catch (error) { return error; }
    finally { settled = true; }
  })();
  await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
  appearance.resolve({ compose: () => ({}), dispose });
  try { expect(await pending).toBe(refused); expect(dispose).not.toHaveBeenCalled(); }
  finally { owner.dispose(); }
  expect(dispose).toHaveBeenCalledTimes(1);
});

test('a late look cannot survive a retired regional owner', async () => {
  const owner = new Scope('regional-retired'), appearance = deferred<LookStrategy>(), dispose = vi.fn((): void => undefined);
  const pending = prepareRegionalInputs({ look: () => appearance.promise }, owner, undefined);
  const rejected = expect(pending).rejects.toThrow('left while loading its inputs');
  owner.dispose(); appearance.resolve({ compose: () => ({}), dispose }); await rejected;
  expect(dispose).toHaveBeenCalledTimes(1);
});


test('look material preparation starts before navigation and both remain required', async () => {
  const owner = new Scope('regional-material-overlap'), nav = deferred<null>(), materials = deferred<undefined>(), started = deferred<undefined>();
  const dispose = vi.fn((): void => undefined), look: LookStrategy = { compose: () => ({}), dispose };
  let settled = false;
  const pending = (async () => {
    try {
      return await prepareRegionalInputs({ look: () => Promise.resolve(look) }, owner, () => nav.promise,
        value => { expect(value).toBe(look); started.resolve(undefined); return materials.promise; });
    } finally { settled = true; }
  })();
  await started.promise;
  expect(settled).toBe(false);
  materials.resolve(undefined); await Promise.resolve();
  expect(settled).toBe(false);
  nav.resolve(null);
  try { expect(await pending).toEqual({ navmesh: null, look }); }
  finally { owner.dispose(); }
  expect(dispose).toHaveBeenCalledTimes(1);
});

test('navigation failure drains material preparation and keeps failure precedence', async () => {
  const owner = new Scope('regional-material-refusal'), nav = deferred<null>(), materials = deferred<undefined>(), started = deferred<undefined>();
  const navigationError = new Error('Navigation refused'), materialError = new Error('Material refused'), dispose = vi.fn((): void => undefined);
  let settled = false;
  const pending = (async (): Promise<unknown> => {
    try {
      await prepareRegionalInputs({ look: () => Promise.resolve({ compose: () => ({}), dispose }) }, owner, () => nav.promise,
        () => { started.resolve(undefined); return materials.promise; });
      return null;
    } catch (error) { return error; }
    finally { settled = true; }
  })();
  await started.promise;
  nav.reject(navigationError); await Promise.resolve();
  expect(settled).toBe(false);
  materials.reject(materialError);
  try { expect(await pending).toBe(navigationError); }
  finally { owner.dispose(); }
  expect(dispose).toHaveBeenCalledTimes(1);
});


test('retirement during material preparation cannot publish regional inputs', async () => {
  const owner = new Scope('regional-material-retirement'), materials = deferred<undefined>(), started = deferred<undefined>();
  const dispose = vi.fn((): void => undefined);
  const pending = prepareRegionalInputs({ look: () => Promise.resolve({ compose: () => ({}), dispose }) }, owner, undefined,
    () => { started.resolve(undefined); return materials.promise; });
  const refused = expect(pending).rejects.toThrow('left while loading its inputs');
  await started.promise;
  owner.dispose(); materials.resolve(undefined);
  await refused;
  expect(dispose).toHaveBeenCalledTimes(1);
});

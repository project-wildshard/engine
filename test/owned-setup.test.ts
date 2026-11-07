import {expect, test} from 'vitest';
import {ownedSetup} from './fixtures/ownedSetup';

test('teardown drains initialization that finishes after its hook has retired', async () => {
  let ready: (value: number) => void = () => undefined;
  let releases = 0, closed = false;
  const setup = ownedSetup(() => new Promise<number>(resolve => {ready = resolve;}), value => {
    expect(value).toBe(7); releases++;
    return Promise.resolve();
  });
  const opening = setup.open();
  const closing = setup.close();
  expect(setup.close()).toBe(closing);
  void closing.then(() => {closed = true; return undefined;});
  await Promise.resolve();
  expect(closed).toBe(false); expect(releases).toBe(0);
  ready(7);
  expect(await opening).toBe(7);
  await closing;
  expect(releases).toBe(1); expect(closed).toBe(true);
  await expect(setup.open()).rejects.toThrow('already opened or closed');
});

test('preparation and disposal retain their original failures without creating replacements', async () => {
  const refused = new Error('Original worker refused');
  let disposals = 0;
  const setup = ownedSetup(() => Promise.reject(refused), () => {disposals++; return Promise.resolve();});
  await expect(setup.open()).rejects.toBe(refused);
  await setup.close();
  expect(disposals).toBe(0);
  const failedDisposal = ownedSetup(() => Promise.resolve(3), () => {disposals++; return Promise.reject(refused);});
  expect(await failedDisposal.open()).toBe(3);
  await expect(failedDisposal.close()).rejects.toBe(refused);
  await expect(failedDisposal.close()).rejects.toBe(refused);
  expect(disposals).toBe(1);
});

test('closing unopened setup performs no work and forbids a later start', async () => {
  let starts = 0;
  const setup = ownedSetup(() => {starts++; return Promise.resolve(1);}, () => Promise.resolve());
  await setup.close();
  await expect(setup.open()).rejects.toThrow('already opened or closed');
  expect(starts).toBe(0);
});

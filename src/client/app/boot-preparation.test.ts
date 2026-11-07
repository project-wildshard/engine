import { expect, test } from 'vitest';
import { prepareBootImports } from './bootDownloads';

function delayed<T>() {
  let fulfill: (value: T) => void = () => { throw new Error('Uninitialized deferred'); };
  let fail: (error: unknown) => void = () => { throw new Error('Uninitialized deferred'); };
  const promise = new Promise<T>((resolve, reject) => { fulfill = resolve; fail = reject; });
  return { promise, resolve: fulfill, reject: fail };
}

test('pending imports do not block preparation checks, but their barrier retains the original values', async () => {
  const code = delayed<object>(), value = {}, imports = prepareBootImports(code.promise);
  expect(() => { imports.check(); }).not.toThrow();
  code.resolve(value);
  expect(await imports.ready()).toBe(value);
  expect(await imports.ready()).toBe(value);
  expect(() => { imports.check(); }).not.toThrow();
});

test('early import rejection stays owned and precedes a later refusal', async () => {
  const reason = new Error('kit import failed'), imports = prepareBootImports(Promise.reject(reason));
  // Let the rejection settle before any consumer reaches the original barrier.
  await new Promise(resolve => { setTimeout(resolve, 0); });
  expect(() => imports.check()).toThrow();
  await expect(imports.ready()).rejects.toBe(reason);
  await expect(imports.refuse(new Error('admission failed'))).rejects.toBe(reason);
});

test.each([true, false])('a failed admission waits for imports before cleanup; import failure=%s', async fails => {
  const code = delayed<boolean>(), imports = prepareBootImports(code.promise);
  const admission = new Error('admission failed'), kit = new Error('kit failed'), events: string[] = [];
  const refused = imports.refuse(admission).finally(() => { events.push('residency', 'memory'); });
  const observed = expect(refused).rejects.toBe(fails ? kit : admission);
  await Promise.resolve();
  expect(events).toEqual([]);
  if (fails) code.reject(kit); else code.resolve(true);
  await observed;
  expect(events).toEqual(['residency', 'memory']);
});

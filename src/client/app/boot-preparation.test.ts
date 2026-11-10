import { Scope } from '@wildshard/engine/app/scope';
import { expect, test, vi } from 'vitest';
import { prepareBootImports, startTitleWarmup } from './bootDownloads';

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

function titleWarmup() {
  const code = delayed<{ warmShaderCompiler: () => void }>();
  const page = Object.assign(new EventTarget(), { reportError: vi.fn<(error: unknown) => void>() });
  const owner = new Scope('test.title-warmup');
  const warmShaderCompiler = vi.fn<() => void>();
  return { code, page, owner, warmShaderCompiler };
}

test.each([new TypeError('Importing a module script failed.'), new DOMException('Cancelled', 'AbortError')])(
  'a rejected optional shader import on navigation never becomes unhandled: %s', async reason => {
    const { code, page, owner } = titleWarmup();
    const unhandled: unknown[] = [];
    const record = (error: unknown): void => { unhandled.push(error); };
    process.on('unhandledRejection', record);
    try {
      const settled = startTitleWarmup(code.promise, owner, page);
      page.dispatchEvent(new Event('beforeunload'));
      code.reject(reason);
      await new Promise(resolve => { setTimeout(resolve, 0); });
      await settled;
      expect(page.reportError).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
    } finally { process.off('unhandledRejection', record); owner.dispose(); }
  },
);

test.each([false, true])('real import failures still report, even during departure: leaving=%s', async leaving => {
  const { code, page, owner } = titleWarmup();
  const failure = new TypeError(leaving ? 'Wrong shader input' : 'Importing a module script failed.');
  const settled = startTitleWarmup(code.promise, owner, page);
  if (leaving) page.dispatchEvent(new Event('pagehide'));
  code.reject(failure);
  await settled;
  expect(page.reportError).toHaveBeenCalledExactlyOnceWith(failure);
  owner.dispose();
});

test.each([false, true])('a restored title owns the pending warm-up and releases its listeners: success=%s', async succeeds => {
  const { code, page, owner, warmShaderCompiler } = titleWarmup();
  const added = vi.spyOn(page, 'addEventListener'), removed = vi.spyOn(page, 'removeEventListener');
  const failure = new DOMException('Live failure', 'AbortError');
  const settled = startTitleWarmup(code.promise, owner, page);
  page.dispatchEvent(new Event('pagehide'));
  page.dispatchEvent(new Event('pageshow'));
  if (succeeds) code.resolve({ warmShaderCompiler }); else code.reject(failure);
  await settled;
  expect(warmShaderCompiler).toHaveBeenCalledTimes(succeeds ? 1 : 0);
  expect(page.reportError.mock.calls).toEqual(succeeds ? [] : [[failure]]);
  expect(removed.mock.calls).toHaveLength(3);
  for (const [type, listener] of added.mock.calls) expect(removed.mock.calls).toContainEqual([type, listener, undefined]);
  owner.dispose();
});

test('a departing title does not run a warm-up that arrives late', async () => {
  const { code, page, owner, warmShaderCompiler } = titleWarmup();
  const settled = startTitleWarmup(code.promise, owner, page);
  page.dispatchEvent(new Event('beforeunload'));
  code.resolve({ warmShaderCompiler });
  await settled;
  expect(warmShaderCompiler).not.toHaveBeenCalled();
  owner.dispose();
});

test('a real exception from the warm-up callback is reported', async () => {
  const { code, page, owner } = titleWarmup();
  const failure = new Error('Shader warm-up bug');
  const settled = startTitleWarmup(code.promise, owner, page);
  code.resolve({ warmShaderCompiler: () => { throw failure; } });
  await settled;
  expect(page.reportError).toHaveBeenCalledExactlyOnceWith(failure);
  owner.dispose();
});

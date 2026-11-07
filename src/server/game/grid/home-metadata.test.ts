import { expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { initialHomeMetadataRequired, prepareHomeMetadata, withInitialHomeMetadata } from '../../../client/game/grid/homeMetadata';

function deferred<T>() {
  let finish = (_value: T): void => { throw new Error('Missing resolver'); };
  const ready = new Promise<T>(resolve => { finish = resolve; });
  return { ready, finish };
}

test('session work overlaps the same metadata read without moving the Home barrier', async () => {
  const page = new Scope('page'), source = deferred<{ release: () => void }>(), session = deferred<undefined>();
  const release = vi.fn<() => void>(), read = vi.fn(() => source.ready), events: string[] = [];
  const creating = withInitialHomeMetadata(page, read, async homeReady => {
    events.push('create'); await session.ready; events.push('created');
    return { homeReady };
  });
  await Promise.resolve();
  expect(read).toHaveBeenCalledOnce(); expect(events).toEqual(['create']);
  session.finish(undefined); const created = await creating;
  let entered = false;
  const home = created.homeReady.then(() => { entered = true; return undefined; });
  await Promise.resolve(); expect(entered).toBe(false); expect(release).not.toHaveBeenCalled();
  source.finish({ release }); await home;
  expect(entered).toBe(true); expect(read).toHaveBeenCalledOnce(); expect(release).not.toHaveBeenCalled();
  page.dispose(); expect(release).toHaveBeenCalledOnce();
});

test('early metadata rejection stays at Home and does not reject session creation', async () => {
  const page = new Scope('page'), error = new Error('Original metadata refusal');
  const read = vi.fn(() => Promise.reject(error));
  const created = await withInitialHomeMetadata(page, read, ready => Promise.resolve({ ready }));
  await expect(created.ready).rejects.toBe(error);
  await expect(created.ready).rejects.toBe(error);
  expect(read).toHaveBeenCalledOnce(); page.dispose();
});

test.each([false, true])('failed session drops its metadata lease without retiring the page (settled=%s)', async settled => {
  const page = new Scope('page'), source = deferred<{ release: () => void }>(), session = deferred<undefined>();
  const release = vi.fn<() => void>(), error = new Error('Original session refusal');
  const read = vi.fn(() => source.ready);
  const creating = withInitialHomeMetadata(page, read, async ready => {
    await session.ready;
    if (settled) await ready;
    throw error;
  });
  await Promise.resolve();
  if (settled) source.finish({ release });
  session.finish(undefined); await expect(creating).rejects.toBe(error);
  expect(page.disposed).toBe(false);
  if (!settled) source.finish({ release });
  await Promise.resolve(); await Promise.resolve();
  expect(release).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce();
  page.dispose(); expect(release).toHaveBeenCalledOnce();
});

test('metadata starts before the barrier and keeps one page-owned lease', async () => {
  const owner = new Scope('initial home'), release = vi.fn<() => void>();
  const read = vi.fn(() => Promise.resolve({ release }));
  const ready = prepareHomeMetadata(owner, read);
  await ready;
  expect(read).toHaveBeenCalledOnce(); expect(release).not.toHaveBeenCalled();
  await ready; expect(read).toHaveBeenCalledOnce();
  owner.dispose(); owner.dispose(); expect(release).toHaveBeenCalledOnce();
});

test('an early rejection remains the exact barrier error without a retry', async () => {
  const owner = new Scope('refused home'), error = new Error('Exact metadata refusal');
  const read = vi.fn(() => Promise.reject(error)), ready = prepareHomeMetadata(owner, read);
  await expect(ready).rejects.toBe(error); await expect(ready).rejects.toBe(error);
  expect(read).toHaveBeenCalledOnce(); owner.dispose();
});

test('closed pages start no read and late results release before refusing', async () => {
  const closed = new Scope('already closed'); closed.dispose();
  const read = vi.fn(() => Promise.resolve(null));
  await expect(prepareHomeMetadata(closed, read)).rejects.toThrow('owner left');
  expect(read).not.toHaveBeenCalled();
  const owner = new Scope('late home'), release = vi.fn<() => void>();
  let finish = (_value: { release: () => void }): void => { throw new Error('Missing resolver'); };
  const pending = new Promise<{ release: () => void }>(resolve => { finish = resolve; });
  const ready = prepareHomeMetadata(owner, () => pending);
  await Promise.resolve(); owner.dispose(); finish({ release });
  await expect(ready).rejects.toThrow('owner left'); expect(release).toHaveBeenCalledOnce();
});

test('an unavailable descriptor adds no metadata work or new refusal', async () => {
  const owner = new Scope('unavailable');
  await expect(prepareHomeMetadata(owner, () => null)).resolves.toBeUndefined(); owner.dispose();
});

test('an ancestor retiring between slices cannot acquire a home lease', async () => {
  const parent = new Scope('retiring page'), owner = parent.child('home metadata');
  // Reverse cleanup order pauses the parent before it reaches this child.
  parent.onDispose(() => undefined);
  const release = vi.fn<() => void>();
  let finish = (_value: { release: () => void }): void => { throw new Error('Missing resolver'); };
  const pending = new Promise<{ release: () => void }>(resolve => { finish = resolve; });
  const ready = prepareHomeMetadata(owner, () => pending);
  await Promise.resolve();
  const retiring = parent.disposeSteps(); retiring.next();
  expect(owner.disposed).toBe(false); expect(owner.disposing).toBe(true);
  const read = vi.fn(() => Promise.resolve(null));
  await expect(prepareHomeMetadata(owner, read)).rejects.toThrow('owner left');
  expect(read).not.toHaveBeenCalled();
  finish({ release });
  await expect(ready).rejects.toThrow('owner left'); expect(release).toHaveBeenCalledOnce();
  for (const _step of retiring) { /* Drain the original sliced teardown. */ }
  expect(release).toHaveBeenCalledOnce();
});

test('only actual initial homes prefetch, never standalone or road recovery', () => {
  const common = { instance: 'cell-0-0', slug: 'driftwood-isle', catalogue: 'catalogue', at: 1, road: { x: 0, z: 0, yaw: 0 } };
  const recovery = { ...common, reason: 'reload' as const };
  expect(initialHomeMetadataRequired({})).toBe(false);
  expect(initialHomeMetadataRequired({ ownedGridHome: true })).toBe(true);
  expect(initialHomeMetadataRequired({ ownedGridHome: true, recovery })).toBe(false);
  expect(initialHomeMetadataRequired({ ownedGridHome: true, recovery: { ...recovery, saved: { ...common, location: { kind: 'road' } } } })).toBe(false);
  expect(initialHomeMetadataRequired({ ownedGridHome: true, recovery: { ...recovery, saved: { ...common, location: { kind: 'cell', x: 0, y: 0, z: 0, yaw: 0 } } } })).toBe(true);
});

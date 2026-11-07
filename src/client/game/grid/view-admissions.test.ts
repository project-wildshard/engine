import { expect, test, vi } from 'vitest';
import { GridViewAdmissions } from './viewAdmissions';
import { ApproachInputsDeferredError } from './productInputs';

const cell = { instance: 'cell' };
test('headroom deferral retries only on cost change or actual demand', async () => {
  let revision = 0;
  const start = vi.fn((_cell: typeof cell, required: boolean, offered: () => void) => {
    if (!required) return Promise.reject(new ApproachInputsDeferredError());
    offered(); return Promise.resolve();
  });
  const requests = new GridViewAdmissions(start, () => revision);
  await expect(requests.complete(cell)).rejects.toBeInstanceOf(ApproachInputsDeferredError);
  await expect(requests.render(cell)).rejects.toBeInstanceOf(ApproachInputsDeferredError);
  expect(start).toHaveBeenCalledTimes(1);
  revision++;
  await expect(requests.complete(cell)).rejects.toBeInstanceOf(ApproachInputsDeferredError);
  expect(start).toHaveBeenCalledTimes(2);
  await requests.complete(cell, true); await requests.render(cell);
  expect(start.mock.calls.map(row => row[1])).toEqual([false, false, true]);
});

test('actual demand joined to pending optional IO promotes after its deferral', async () => {
  let refuse = (_error: Error): void => undefined;
  const pending = new Promise<void>((_resolve, reject) => { refuse = reject; });
  const start = vi.fn((_cell: typeof cell, required: boolean, offered: () => void) => {
    if (!required) return pending; offered(); return Promise.resolve();
  });
  const requests = new GridViewAdmissions(start, () => 0);
  const optional = requests.render(cell), required = requests.complete(cell, true);
  const rejected = expect(optional).rejects.toBeInstanceOf(ApproachInputsDeferredError);
  refuse(new ApproachInputsDeferredError()); await rejected; await required;
  expect(start.mock.calls.map(row => row[1])).toEqual([false, true]);
});

test('render offer can finish before life work, while complete still waits', async () => {
  let offer = (): void => undefined, finish = (): void => undefined;
  const life = new Promise<void>(resolve => { finish = resolve; });
  const start = vi.fn((_cell: typeof cell, _required: boolean, offered: () => void) => { offer = offered; return life; });
  const requests = new GridViewAdmissions(start, () => 0), done = vi.fn();
  const render = requests.render(cell), full = (async () => { await requests.complete(cell, true); done(); })();
  offer(); await render; expect(done).not.toHaveBeenCalled();
  finish(); await full; expect(done).toHaveBeenCalledOnce(); expect(start).toHaveBeenCalledOnce();
});

test('real refusal retains its identity and never retries with a changed budget', async () => {
  const failure = new Error('Material hash mismatch'), start = vi.fn(() => Promise.reject(failure));
  let revision = 0;
  const requests = new GridViewAdmissions(start, () => revision);
  await expect(requests.render(cell)).rejects.toBe(failure); revision++;
  await expect(requests.complete(cell, true)).rejects.toBe(failure);
  expect(start).toHaveBeenCalledOnce();
});

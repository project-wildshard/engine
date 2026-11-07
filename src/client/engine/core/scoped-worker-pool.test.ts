import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { realGc } from '../../../test/engine/realGc';
import { ScopedWorkerPool } from './scopedWorkerPool';

class ControlledWorker extends EventTarget implements Worker {
  onerror: Worker['onerror'] = null;
  onmessage: Worker['onmessage'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  readonly sent: { message: unknown; transfer: Transferable[] | undefined }[] = [];
  terminated = false;
  postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions): void {
    const transfer = Array.isArray(options) ? options : options?.transfer;
    this.sent.push({message, transfer});
  }
  terminate(): void { this.terminated = true; }
  reply(data: unknown): void { this.dispatchEvent(new MessageEvent('message', {data})); }
}

afterEach(() => { vi.useRealTimers();vi.restoreAllMocks(); });

test('an idle live texture worker releases its completed reply backing', async () => {
  await realGc('src/client/engine/core/scoped-worker-pool.test.ts', 'an idle live texture worker releases', async collect => {
    const owner = new Scope('texture-worker'), pool = new ScopedWorkerPool(owner, 1), worker = new ControlledWorker();
    pool.setWorkerCreator(() => worker);
    try {
      const backing = await (async () => {
        const bytes = new Uint8Array(1024 * 1024), pending = pool.postMessage({job: 1}, []);
        const reply = {mipmaps: [{data: bytes}]};
        worker.reply(reply);
        const result = await pending;
        // Preserve the exact payload without enumerating a million typed-array
        // indices before the real-GC assertion's unchanged five-second deadline.
        expect(result.data).toBe(reply);
        return new WeakRef(bytes.buffer);
      })();
      await collect(backing);
      expect(worker.terminated).toBe(false);
      expect(pool.workers).toHaveLength(1);
      const next = pool.postMessage({job: 2}, []);
      worker.reply({done: 2});
      expect((await next).data).toEqual({done: 2});
    } finally { owner.dispose(); }
    expect(worker.terminated).toBe(true);
  });
});

test('queued texture jobs retain their own resolver and original transfer list', async () => {
  const owner = new Scope('queued-textures'), pool = new ScopedWorkerPool(owner, 1), worker = new ControlledWorker();
  pool.setWorkerCreator(() => worker);
  try {
    const firstTransfer = [new ArrayBuffer(4)], secondTransfer = [new ArrayBuffer(8)];
    const first = pool.postMessage({job: 1}, firstTransfer), second = pool.postMessage({job: 2}, secondTransfer);
    expect(worker.sent).toEqual([{message: {job: 1}, transfer: firstTransfer}]);
    worker.reply({done: 1});
    expect((await first).data).toEqual({done: 1});
    expect(worker.sent[1]).toEqual({message: {job: 2}, transfer: secondTransfer});
    expect(worker.sent[1]?.transfer).toBe(secondTransfer);
    worker.reply({done: 2});
    expect((await second).data).toEqual({done: 2});
  } finally { owner.dispose(); }
});

test('an unused texture pool starts no worker or idle timer', () => {
  vi.useFakeTimers();
  const owner = new Scope('unused-textures'), pool = new ScopedWorkerPool(owner, 1), create = vi.fn(() => new ControlledWorker());
  pool.setWorkerCreator(create);
  try {
    vi.advanceTimersByTime(60_000);
    expect(create).not.toHaveBeenCalled();expect(pool.workers).toHaveLength(0);expect(owner.census.timers).toBe(0);
  } finally { owner.dispose(); }
});

test('settled texture workers retire after thirty idle seconds and recreate on demand', async () => {
  vi.useFakeTimers();
  const owner = new Scope('idle-textures'), pool = new ScopedWorkerPool(owner, 1), workers: ControlledWorker[] = [];
  pool.setWorkerCreator(() => { const worker = new ControlledWorker();workers.push(worker);return worker; });
  try {
    const first = pool.postMessage({job: 1}, []), worker = workers[0];
    if (worker === undefined) throw new Error('Missing first texture worker');
    worker.reply({done: 1});await first;
    vi.advanceTimersByTime(29_999);expect(worker.terminated).toBe(false);
    vi.advanceTimersByTime(1);expect(worker.terminated).toBe(true);
    expect(pool.workers).toHaveLength(0);expect(pool.workersResolve).toHaveLength(0);
    expect(owner.census.listeners).toBe(0);expect(owner.census.timers).toBe(0);
    const transfer = [new ArrayBuffer(8)], next = pool.postMessage({job: 2}, transfer), replacement = workers[1];
    if (replacement === undefined) throw new Error('Missing replacement texture worker');
    expect(replacement).not.toBe(worker);expect(replacement.sent).toEqual([{message: {job: 2}, transfer}]);
    expect(replacement.sent[0]?.transfer).toBe(transfer);
    replacement.reply({done: 2});expect((await next).data).toEqual({done: 2});
  } finally { owner.dispose(); }
  expect(workers.every(worker => worker.terminated)).toBe(true);expect(vi.getTimerCount()).toBe(0);
});

test('one busy or queued texture job prevents retirement of every pool worker', async () => {
  vi.useFakeTimers();
  const owner = new Scope('busy-textures'), pool = new ScopedWorkerPool(owner, 2), workers: ControlledWorker[] = [];
  pool.setWorkerCreator(() => { const worker = new ControlledWorker();workers.push(worker);return worker; });
  try {
    const first = pool.postMessage({job: 1}, []), second = pool.postMessage({job: 2}, []), third = pool.postMessage({job: 3}, []);
    const left = workers[0], right = workers[1];
    if (left === undefined || right === undefined) throw new Error('Missing parallel texture workers');
    left.reply({done: 1});await first;
    expect(left.sent.map(row => row.message)).toEqual([{job: 1}, {job: 3}]);
    vi.advanceTimersByTime(60_000);expect(workers.every(worker => !worker.terminated)).toBe(true);
    left.reply({done: 3});await third;
    vi.advanceTimersByTime(60_000);expect(workers.every(worker => !worker.terminated)).toBe(true);
    right.reply({done: 2});await second;
    vi.advanceTimersByTime(30_000);expect(workers.every(worker => worker.terminated)).toBe(true);
  } finally { owner.dispose(); }
});

test('a new texture request cancels retirement until its own idle boundary', async () => {
  vi.useFakeTimers();
  const owner = new Scope('renewed-textures'), pool = new ScopedWorkerPool(owner, 1), worker = new ControlledWorker();
  pool.setWorkerCreator(() => worker);
  try {
    const first = pool.postMessage({job: 1}, []);worker.reply({done: 1});await first;
    vi.advanceTimersByTime(29_999);
    const second = pool.postMessage({job: 2}, []);
    vi.advanceTimersByTime(60_000);expect(worker.terminated).toBe(false);
    worker.reply({done: 2});await second;
    vi.advanceTimersByTime(29_999);expect(worker.terminated).toBe(false);
    vi.advanceTimersByTime(1);expect(worker.terminated).toBe(true);
    owner.dispose();expect(vi.getTimerCount()).toBe(0);
    await expect(pool.postMessage({job: 3}, [])).rejects.toThrow('owner is disposed');
  } finally { owner.dispose(); }
});

test('a retired texture worker and its private backing collect with the pool alive', async () => {
  await realGc('src/client/engine/core/scoped-worker-pool.test.ts', 'a retired texture worker and its private backing', async collect => {
    vi.useFakeTimers();
    const owner = new Scope('collected-textures'), pool = new ScopedWorkerPool(owner, 1);
    pool.setWorkerCreator(() => Object.assign(new ControlledWorker(), {heap: new Uint8Array(1024 * 1024)}));
    try {
      const refs = await (async () => {
        const pending = pool.postMessage({job: 1}, []), worker = pool.workers[0];
        if (!(worker instanceof ControlledWorker)) throw new Error('Missing owned texture worker');
        const heap: unknown = Reflect.get(worker, 'heap');
        if (!(heap instanceof Uint8Array)) throw new Error('Missing private worker backing');
        worker.reply({done: 1});await pending;
        return {worker: new WeakRef(worker), backing: new WeakRef(heap.buffer)};
      })();
      vi.advanceTimersByTime(30_000);vi.useRealTimers();
      expect(pool.workers).toHaveLength(0);expect(owner.census.listeners).toBe(0);
      await collect(refs.worker);await collect(refs.backing);
    } finally { vi.useRealTimers();owner.dispose(); }
  });
});

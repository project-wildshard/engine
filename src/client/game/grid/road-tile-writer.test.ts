import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { roadTileWriter } from './roadTileWriter';

const HASH = 'a'.repeat(64), ORIGIN = 'https://wildshard.test';
const posted: { url: string; bytes: Uint8Array }[] = [], workers: FakeWorker[] = [];
// answer: the worker's reply to a write (refused hands the body back; null never answers)
let answer: 'ok' | 'refused' | null = 'ok', refuse = false, announce = true;
class FakeWorker extends EventTarget {
  constructor() { super(); if (refuse) throw new Error('no worker'); workers.push(this); if (announce) this.ready(); }
  ready(): void { queueMicrotask(() => { this.dispatchEvent(new MessageEvent('message', { data: { ready: true } })); }); }
  crash(): void { this.dispatchEvent(new Event('error', { cancelable: true })); }
  postMessage(message: { id: number; url: string; bytes: Uint8Array }, options: { transfer: ArrayBuffer[] }): void {
    const copy = new Uint8Array(structuredClone(message.bytes));
    posted.push({ url: message.url, bytes: copy });
    // The real port detaches the transferred body.
    structuredClone(message.bytes.buffer, { transfer: options.transfer });
    const data = answer === 'ok' ? { id: message.id, ok: true } : { id: message.id, ok: false, bytes: copy };
    if (answer !== null) queueMicrotask(() => { this.dispatchEvent(new MessageEvent('message', { data })); });
  }
  terminate(): void { /* nothing to stop */ }
}
function storage(puts: string[], bodies: number[] = []): Pick<CacheStorage, 'open'> {
  const cache: Cache = {
    put: (request: RequestInfo | URL, response: Response) => {
      puts.push(request instanceof Request ? request.url : request instanceof URL ? request.href : request);
      bodies.push(Number(response.headers.get('content-length'))); return Promise.resolve();
    },
    match: () => Promise.reject(new Error('Unexpected read')), matchAll: () => Promise.reject(new Error('Unexpected bodies')),
    add: () => Promise.reject(new Error('Unexpected fetch')), addAll: () => Promise.reject(new Error('Unexpected fetches')),
    delete: () => Promise.reject(new Error('Unexpected deletion')), keys: () => Promise.reject(new Error('Unexpected inventory')),
  };
  return { open: () => Promise.resolve(cache) };
}
const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });
const original: unknown = Reflect.get(globalThis, 'Worker');
afterEach(() => { vi.stubGlobal('Worker', original); posted.length = 0; workers.length = 0; answer = 'ok'; refuse = false; announce = true; });

test('once the worker runs, road writes transfer a whole body to it at the original URL and answer its result', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const scope = new Scope('writer'), puts: string[] = [], store = roadTileWriter(scope, storage(puts), ORIGIN);
  await expect(store.put(HASH, Uint8Array.from([9]))).resolves.toBe(true);
  expect(puts).toHaveLength(1); expect(posted).toHaveLength(0);
  await settle();
  const bytes = Uint8Array.from([1, 2, 3]);
  await expect(store.put(HASH, bytes)).resolves.toBe(true);
  expect(bytes.length).toBe(0); expect(puts).toHaveLength(1);
  expect(posted).toEqual([{ url: `${ORIGIN}/assets/grid-road/${HASH}.bin`, bytes: Uint8Array.from([1, 2, 3]) }]);
  scope.dispose();
});

test('a worker that fails while starting loses no write: every body keeps the page put', async () => {
  vi.stubGlobal('Worker', FakeWorker); announce = false;
  const scope = new Scope('writer start'), puts: string[] = [], bodies: number[] = [], store = roadTileWriter(scope, storage(puts, bodies), ORIGIN);
  const first = Uint8Array.from([1, 2, 3, 4]);
  await expect(store.put(HASH, first)).resolves.toBe(true);
  workers[0]?.crash(); await settle();
  await expect(store.put(HASH, Uint8Array.from([5, 6]))).resolves.toBe(true);
  expect(first.length).toBe(4); expect(posted).toHaveLength(0); expect(bodies).toEqual([4, 2]);
  scope.dispose();
});

test('a write the worker refuses comes back with its body and is retried on the page', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const scope = new Scope('writer refusal'), puts: string[] = [], bodies: number[] = [], store = roadTileWriter(scope, storage(puts, bodies), ORIGIN);
  await store.put(HASH, Uint8Array.from([0])); await settle(); puts.length = 0; bodies.length = 0;
  answer = 'refused';
  await expect(store.put(HASH, Uint8Array.from([7, 8, 9]))).resolves.toBe(true);
  expect(posted).toHaveLength(1); expect(puts).toEqual([`${ORIGIN}/assets/grid-road/${HASH}.bin`]); expect(bodies).toEqual([3]);
  scope.dispose();
});

test('a view, a refused worker, a dead worker or a retired owner keeps the page put or refuses', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const scope = new Scope('writer views'), puts: string[] = [], store = roadTileWriter(scope, storage(puts), ORIGIN);
  await store.put(HASH, Uint8Array.from([0])); await settle(); puts.length = 0;
  const view = new Uint8Array(new ArrayBuffer(8), 2, 3);
  await expect(store.put(HASH, view)).resolves.toBe(true);
  expect(view.length).toBe(3); expect(puts).toHaveLength(1); expect(posted).toHaveLength(0);
  // a worker dying with a transferred write in flight refuses that write (a full cache does the same); later writes
  // go back to the page
  answer = null; const pending = store.put(HASH, Uint8Array.from([1]));
  workers[0]?.crash(); await expect(pending).resolves.toBe(false);
  await expect(store.put(HASH, Uint8Array.from([2]))).resolves.toBe(true); expect(puts).toHaveLength(2);
  scope.dispose(); await expect(store.put(HASH, Uint8Array.from([1]))).resolves.toBe(false);
  refuse = true;
  const fallback = roadTileWriter(new Scope('writer refused'), storage(puts), ORIGIN), body = Uint8Array.from([5]);
  await expect(fallback.put(HASH, body)).resolves.toBe(true); expect(body.length).toBe(1); expect(puts).toHaveLength(3);
});

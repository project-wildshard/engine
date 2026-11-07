/** DL11: road archive writes go to one dedicated worker that owns the Cache
 * Storage put; the page transfers each freshly encoded body instead of copying
 * it. Reads, hashes and URLs are the original store's. Until the worker says it
 * is running, and whenever it cannot start, writes keep the original page-thread
 * put; a write the worker's cache refuses comes back with its body and is retried
 * on the page. Only a worker that dies with transferred writes in flight refuses
 * them (as a full cache does). */
import type { Scope } from '@wildshard/engine/app/scope';
import { roadTileCache, roadTileUrl, type RoadTileStore } from './roadTileArchive';

// Writes happen only while roads are built; a later write restarts the worker.
const IDLE_MS = 10_000;

export function roadTileWriter(scope: Scope, storage: Pick<CacheStorage, 'open'>, origin: string): RoadTileStore {
  const store = roadTileCache(storage, origin);
  if (typeof Worker !== 'function') return store;
  const waiting = new Map<number, { readonly hash: string; readonly finish: (ok: boolean) => void }>(), listeners: (() => void)[] = [];
  let worker: Worker | undefined, ready = false, broken = false, next = 0, idle: ReturnType<Scope['timeout']> | undefined;
  const stop = (): void => {
    scope.cancelTimer(idle); idle = undefined;
    for (const forget of listeners.splice(0)) forget();
    worker?.terminate(); worker = undefined; ready = false;
    for (const row of waiting.values()) row.finish(false);
    waiting.clear();
  };
  scope.onDispose(stop);
  const fail = (): void => { broken = true; stop(); };
  const arm = (): void => {
    scope.cancelTimer(idle); idle = undefined;
    if (waiting.size === 0) idle = scope.timeout(IDLE_MS, () => { idle = undefined; if (waiting.size === 0) stop(); });
  };
  const start = (): Worker | undefined => {
    if (worker !== undefined) return worker;
    try {
      const created = new Worker(new URL('roadTileWrite.worker.ts', import.meta.url), { type: 'module', name: 'grid-road-write' });
      listeners.push(scope.listen(created, 'message', event => {
        const reply: unknown = event.data;
        if (typeof reply !== 'object' || reply === null) { fail(); return; }
        if (Reflect.get(reply, 'ready') === true) { ready = true; arm(); return; }
        const id: unknown = Reflect.get(reply, 'id'), row = typeof id === 'number' ? waiting.get(id) : undefined;
        if (typeof id !== 'number' || row === undefined) { fail(); return; }
        waiting.delete(id);
        const body: unknown = Reflect.get(reply, 'bytes');
        if (Reflect.get(reply, 'ok') === true) row.finish(true);
        else if (body instanceof Uint8Array) void store.put(row.hash, body).then(row.finish);
        else row.finish(false);
        arm();
      }));
      listeners.push(scope.listen(created, 'error', event => { event.preventDefault(); fail(); }));
      listeners.push(scope.listen(created, 'messageerror', fail));
      worker = created; return created;
    } catch { broken = true; return undefined; }
  };
  return { ...store, put: (hash, bytes) => {
    if (scope.disposed || scope.disposing) return Promise.resolve(false);
    const target = broken ? undefined : start();
    // A whole owned buffer transfers once the worker runs; before that, or for a view into a larger buffer, the
    // copying page put keeps its own bytes.
    if (target === undefined || !ready || bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength || !(bytes.buffer instanceof ArrayBuffer)) return store.put(hash, bytes);
    scope.cancelTimer(idle); idle = undefined;
    const id = next++;
    return new Promise<boolean>(resolve => {
      waiting.set(id, { hash, finish: resolve });
      target.postMessage({ id, url: roadTileUrl(origin, hash), bytes }, { transfer: [bytes.buffer] });
    });
  } };
}

import { WorkerScope } from '../app/workerScope.js';

/** J383: downloaded code/content only. Account state, settings and saved documents stay. */
export const FORCE_CACHE_MARKER = 'ws-force-update-j383-v1';
const KEY = '/__force-update-state__';
/** The compiled-home cache is disposable; wildshard-saves and local/sessionStorage are not. */
export const PACK_DATABASES: readonly string[] = ['ws-built-home-v1'];
export type ForceCacheState = 'pending' | 'complete' | null;

export async function forceCacheState(): Promise<ForceCacheState> {
  try {
    if (!await caches.has(FORCE_CACHE_MARKER)) return null;
    const response = await (await caches.open(FORCE_CACHE_MARKER)).match(KEY);
    const value = await response?.text();
    return value === 'complete' || value === 'pending' ? value : null;
  } catch { return null; }
}
export async function setForceCacheState(state: Exclude<ForceCacheState, null>): Promise<void> {
  await (await caches.open(FORCE_CACHE_MARKER)).put(KEY, new Response(state));
}
/** A blocked old connection cannot deadlock activation; the new page completes the pending wipe after unload. */
export function dropPackDatabase(name: string, timeoutMs = 1500): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(true);
  return new Promise(resolve => {
    const scope = new WorkerScope();
    scope.timeout(timeoutMs, () => { scope.dispose(); resolve(false); });
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = (): void => { scope.dispose(); resolve(true); };
      request.onerror = (): void => { scope.dispose(); resolve(false); };
    } catch { scope.dispose(); resolve(false); }
  });
}
/** Delete old caches before creating a fresh migration marker. */
export async function wipeDownloadedCaches(): Promise<boolean> {
  await Promise.all((await caches.keys()).map(name => caches.delete(name)));
  const databases = await Promise.all(PACK_DATABASES.map(name => dropPackDatabase(name)));
  // Another tab may already have recreated the completion marker; that is not stale downloaded data.
  const complete = (await caches.keys()).every(name => name === FORCE_CACHE_MARKER) && databases.every(Boolean);
  await setForceCacheState(complete ? 'complete' : 'pending');
  return complete;
}

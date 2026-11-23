// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { recordSource, replaySource } from '@wildshard/engine/render/shaderSourceCache';
import { openShaderSourceCache, shaderBookIdentity } from './shaderSourceStore';

// STR35 defaults on for phone Low (QA-FEEDBACK-2026-11-19-mini row 11): the stored book is the last boot's, keyed by the
// renderer it was emitted by and the zone (QA-FEEDBACK-2026-11-23 row 8: it was keyed by the deploy, so every update booted
// cold). An update that leaves the renderer alone replays; a renderer change boots cold and emits its own GLSL.

/** A one-store IndexedDB: enough of `open`, `transaction`, `get` and `put` for the store's own calls. */
function fakeIndexedDb(rows: Map<string, unknown>): IDBFactory {
  const later = (fn: () => void): void => { setTimeout(fn, 0); };
  const request = <T>(result: () => T): IDBRequest<T> => {
    const r = { result: undefined as T | undefined, error: null, onsuccess: null as null | (() => void), onerror: null } as unknown as IDBRequest<T> & { onsuccess: null | (() => void) };
    later(() => { Object.assign(r, { result: result() }); r.onsuccess?.(); });
    return r;
  };
  const database = {
    close: (): void => undefined,
    createObjectStore: (): void => undefined,
    transaction: () => {
      const transaction = { oncomplete: null as null | (() => void), onabort: null, error: null,
        objectStore: () => ({
          get: (key: string) => request(() => rows.get(key)),
          put: (value: unknown, key: string) => { rows.set(key, value); later(() => transaction.oncomplete?.()); return request(() => key); },
        }) };
      return transaction;
    },
  };
  return { open: () => request(() => database) } as unknown as IDBFactory;
}

const rows = new Map<string, unknown>();
let saved: IDBFactory | undefined;
beforeEach(() => { rows.clear(); saved = globalThis.indexedDB; globalThis.indexedDB = fakeIndexedDb(rows); });
afterEach(() => { if (saved !== undefined) globalThis.indexedDB = saved; });

const RENDERER_A = 'a'.repeat(64), RENDERER_B = 'b'.repeat(64);

/** One boot: open the cache, replay or emit one lowering, reach control and wait for the write. */
async function boot(build: string, zone: string, renderer: string = RENDERER_A): Promise<{ replayed: unknown; counters: unknown }> {
  const scope = new Scope(`boot-${build}`);
  try {
    await openShaderSourceCache(shaderBookIdentity(renderer, build), zone, scope);
    const replayed = replaySource('lower', 'graph-hash');
    if (replayed === undefined) recordSource('lower', 'graph-hash', `glsl of ${build}`);
    const before = rows.get('last');
    document.dispatchEvent(new Event('ws:control-ready'));
    if (replayed === undefined) for (let turn = 0; turn < 50 && rows.get('last') === before; turn++) await new Promise(resolve => { setTimeout(resolve, 5); });
    return { replayed, counters: JSON.parse(document.documentElement.dataset['shaderSourceCache'] ?? 'null') };
  } finally { scope.dispose(); }
}

test('a new build with the same renderer replays the book: an update that changes no shader is a cache hit', async () => {
  expect((await boot('build-A', 'nine-dragon-stack')).replayed).toBeUndefined();
  const updated = await boot('build-B', 'nine-dragon-stack');
  expect(updated.replayed).toBe('glsl of build-A');
  expect(updated.counters).toEqual({ hits: { lower: 1, wrap: 0, finish: 0 }, emitted: { lower: 0, wrap: 0, finish: 0 } });
});

test('a renderer change boots cold, and the book stays per zone', async () => {
  expect((await boot('build-A', 'nine-dragon-stack')).replayed).toBeUndefined();
  const warm = await boot('build-A', 'nine-dragon-stack');
  expect(warm.replayed).toBe('glsl of build-A');
  expect(warm.counters).toEqual({ hits: { lower: 1, wrap: 0, finish: 0 }, emitted: { lower: 0, wrap: 0, finish: 0 } });
  const upgraded = await boot('build-B', 'nine-dragon-stack', RENDERER_B);
  expect(upgraded.replayed).toBeUndefined();
  expect(upgraded.counters).toEqual({ hits: { lower: 0, wrap: 0, finish: 0 }, emitted: { lower: 1, wrap: 0, finish: 0 } });
  expect((await boot('build-C', 'nine-dragon-stack', RENDERER_B)).replayed).toBe('glsl of build-B');
  expect((await boot('build-C', 'pine-hollow', RENDERER_B)).replayed).toBeUndefined();
});

test('a document with no renderer stamp keys by its build', () => {
  expect(shaderBookIdentity(undefined, 'build-A')).toBe('build:build-A');
  expect(shaderBookIdentity('not-a-hash', 'build-A')).toBe('build:build-A');
  expect(shaderBookIdentity(RENDERER_A, 'build-A')).toBe(shaderBookIdentity(RENDERER_A, 'build-B'));
});

test('a damaged book is ignored', async () => {
  await boot('build-A', 'nine-dragon-stack');
  const entry = rows.get('last') as { bytes: Uint8Array; digest: string };
  rows.set('last', { ...entry, digest: '0'.repeat(64) });
  expect((await boot('build-A', 'nine-dragon-stack')).replayed).toBeUndefined();
});

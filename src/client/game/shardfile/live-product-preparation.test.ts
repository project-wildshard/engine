import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real options factory with explicit worker/cache ports.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Erase only types from the actual factory.
import { stripTypeScriptTypes } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Do not construct a renderer or a real browser worker in this unit control.
import { runInNewContext } from 'node:vm';

test.each([false, true])('boot stays main and only live decoding uses bounded pages: live=%s', async live => {
  const source = readFileSync(new URL('runtimeFolder.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export function browserShardfileOptions('), end = source.indexOf('\n/** Paint before admission', start);
  if (start === -1 || end < start) throw new Error('Product options factory missing');
  const parsed = { rows: [1, 2, 3] }, calls: string[] = [], pause = (): Promise<void> => Promise.resolve();
  const native: { url: string; init: RequestInit }[] = [], wire = new Uint8Array([1, 2, 3]);
  let loanReads = 0, expanded = 0;
  const parser = { parsePaced: (bytes: Uint8Array, actualPause: () => Promise<void>): Promise<unknown> => {
    expect([...bytes]).toEqual([1,2]); expect(actualPause).toBe(pause); calls.push('parse'); return Promise.resolve(parsed);
  } };
  const method: unknown = runInNewContext(stripTypeScriptTypes(`${source.slice(start, end).replace('export function', 'function')}\nbrowserShardfileOptions`), {
    folderControlsReady: live, observesFolderControl: false, document: undefined, caches: {}, navigator: { onLine: true },
    URL, folderResourceRole: () => 'data', waitFor: (_label: string, pending: Promise<Uint8Array>) => pending,
    entryTransport: () => ({ take: () => { loanReads++; throw new Error('Retry must bypass early loan'); }, expand: () => { expanded++; } }),
    readAsset: async (url: string, _bytes: number | undefined, options: { fetch: (path: string, init: RequestInit) => Promise<Response> }) => {
      const response = await options.fetch(url, { cache: 'reload', headers: { 'x-test': 'native' } });
      return new Uint8Array(await response.arrayBuffer());
    },
    fetch: (url: string, init: RequestInit) => { native.push({ url, init }); return Promise.resolve(new Response(wire)); },
    currentSpawnDownload: () => undefined, contentURL: (url: string) => url, // PZ3: no content base
    browserLiveJsonParser: () => { calls.push('parser'); return parser; },
    TIER_CONFIG: {}, TIER: 'phone', splatDrawTier: () => 'phone', splatLayerFile: () => undefined, builtIndexes: null, ktx2TranscodeSupport: () => ({}),
    pauseDescriptor: () => pause,
    // SF28: the stand-in port reads the spawn download's listing
    standInPort: () => ({ listed: () => false, hash: () => undefined }), spawnListedBlobKtx2: () => undefined, spawnListed: () => false, spawnListedHash: () => undefined,
  });
  if (typeof method !== 'function') throw new Error('Product options factory is not callable');
  const result: unknown = Reflect.apply(method, undefined, ['https://game.test/shardfiles/fixture/', true]);
  if (typeof result !== 'object' || result === null || !('pause' in result)) throw new Error('Product options missing pause');
  expect(result.pause).toBe(pause);
  if (!live) {
    expect('parseJson' in result).toBe(false); expect(calls).toEqual([]);
  } else {
    if (!('parseJson' in result) || typeof result.parseJson !== 'function') throw new Error('Live parser missing');
    const value: unknown = await Reflect.apply(result.parseJson, undefined, [new Uint8Array([1,2])]);
    expect(value).toBe(parsed); expect(calls).toEqual(['parser','parse']);
  }
  expect('cache' in result).toBe(false);
  expect('buildRead' in result).toBe(true);
  if (!('buildRead' in result) || typeof result.buildRead !== 'function') throw new Error('Native read capability missing');
  expect(await Reflect.apply(result.buildRead, undefined, ['data.bin', 3, undefined, undefined, 'low'])).toEqual(wire);
  expect(native).toEqual([{ url: 'https://game.test/shardfiles/fixture/data.bin', init: { cache: 'reload', headers: { 'x-test': 'native' }, priority: 'low' } }]);
  expect(loanReads).toBe(0); expect(expanded).toBe(1);
});

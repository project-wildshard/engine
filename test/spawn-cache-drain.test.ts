// @vitest-environment happy-dom
import {expect, test, vi} from 'vitest';
import {prefetchSpawnDownload, setSpawnPacks} from '../src/client/game/boot/spawnDownload';

test('leaving a title drains its native cache read without starting later work', async () => {
  const page = 'https://example.test/';
  let resolveRead = (_response: Response | undefined): void => {throw new Error('Read not installed');};
  const read = {promise: new Promise<Response | undefined>(resolve => {resolveRead = resolve;}), resolve: (response: Response | undefined) => {resolveRead(response);}};
  const match = vi.fn(() => read.promise), network = vi.fn(() => Promise.resolve(new Response('unexpected network')));
  const address = {url: '/assets/spawn/drain.json', bytes: 1, totalBytes: 1, files: 1};
  vi.stubGlobal('location', new URL(page));
  vi.spyOn(document, 'baseURI', 'get').mockReturnValue(page);
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('caches', {open: () => Promise.resolve({match})});
  document.body.innerHTML = `<script id="boot-module-files" type="application/json">${JSON.stringify({spawnManifests: {cacheName: 'assets', client: {drain: {phone: address}}}})}</script>`;
  setSpawnPacks(false);
  const held = prefetchSpawnDownload('drain', 'phone');
  expect(held).not.toBeNull();
  if (held === null) throw new Error('Title download missing');
  try {
    await vi.waitFor(() => {expect(match).toHaveBeenCalledTimes(1);});
    let drained = false;
    const leaving = held.drain().then(() => {drained = true;});
    await expect(held.download.ready).rejects.toThrow();
    expect(drained).toBe(false);
    read.resolve(undefined);
    await leaving;
    expect(drained).toBe(true);
    expect(network).not.toHaveBeenCalled();
    expect(match).toHaveBeenCalledTimes(1);
  } finally { read.resolve(undefined); held.stop(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});

// @vitest-environment happy-dom
import {expect, test, vi} from 'vitest';
import {currentSpawnDownload, prefetchSpawnDownload, releaseSpawnMembers, setSpawnPacks, spawnHeldBytes} from '../src/client/game/boot/spawnDownload';

test('verified packed files stay readable after control when native publication exhausts quota', async () => {
  const base = 'https://example.test/', slug = 'post-quota', reads: string[] = [], stored = new Map<string, Response>();
  const bin = {url: `/shardfiles/${slug}/blobs/bin/${'a'.repeat(64)}.bin`, bytes: 4, hash: '27ecd0a598e76f8a2fd264d427df0a119903e8eae384e478902541756f089dd1'};
  const glb = {url: `/shardfiles/${slug}/blobs/glb/${'b'.repeat(64)}.glb`, bytes: 5, hash: '7dfd2b6c5b422920757984cf2cbce642dca9a05207c57af24ad995b2d90fb4e9'};
  const hash = 'c'.repeat(64), part = {url: `/assets/spawn/parts/${hash.slice(0, 16)}.pack.br`, bytes: 21, hash, members: [[0, 0], [1, 16]]};
  const bytes = Uint8Array.from({length: 21}, (_, at) => at < 4 ? 1 : at >= 16 ? 2 : 0);
  const text = JSON.stringify({version: 1, shard: slug, tier: 'phone', flow: 'client', files: [bin, glb], totalBytes: 9, parts: [part]});
  const address = {url: `/assets/spawn/${slug}-1234567890abcdef.json`, bytes: text.length, totalBytes: 9, files: 2};
  let full = false, nativeReads = 0;
  vi.stubGlobal('__BUILD_ID__', 'proof'); vi.stubGlobal('location', new URL(base));
  vi.spyOn(document, 'baseURI', 'get').mockReturnValue(base);
  document.body.innerHTML = `<script id="boot-module-files" type="application/json">${JSON.stringify({spawnManifests: {cacheName: 'assets', client: {[slug]: {phone: {...address, url: '/assets/spawn/default.json'}}}}})}</script>`;
  vi.stubGlobal('caches', {open: () => Promise.resolve({
    match: (url: string) => { nativeReads++; return Promise.resolve(stored.get(url)?.clone()); },
    put: (url: string, response: Response) => {
      if (full) return Promise.reject(new DOMException('Disk full', 'QuotaExceededError'));
      stored.set(url, response); return Promise.resolve();
    },
  })});
  vi.stubGlobal('fetch', (input: string | URL) => {
    const path = new URL(input).pathname; reads.push(path);
    if (path.endsWith('packs-proof.json')) return Promise.resolve(Response.json({book: 'packs', build: 'proof', client: {[slug]: {phone: address}}}));
    return Promise.resolve(path === address.url ? new Response(text) : path === part.url ? new Response(bytes) : new Response('', {status: 404}));
  });
  try {
    setSpawnPacks(true); prefetchSpawnDownload(slug, 'phone'); await currentSpawnDownload()?.ready;
    releaseSpawnMembers(); stored.clear(); full = true; reads.length = 0;
    const first = await fetch(new URL(glb.url, base));
    expect(first.status).toBe(200);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array(5).fill(2));
    const checked = nativeReads;
    const again = await fetch(new URL(glb.url, base));
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(new Uint8Array(5).fill(2));
    expect(new Uint8Array(await spawnHeldBytes(new URL(glb.url, base).href) ?? new ArrayBuffer(0))).toEqual(new Uint8Array(5).fill(2));
    expect(nativeReads).toBe(checked);
    expect(reads.filter(path => path === part.url)).toHaveLength(1);
  } finally {releaseSpawnMembers(); vi.unstubAllGlobals(); vi.restoreAllMocks();}
});

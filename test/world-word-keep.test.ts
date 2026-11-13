// oxlint-disable-next-line import/no-nodejs-modules -- It signs as the promoter does.
import { generateKeyPairSync, sign } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The release file's own origin.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Its port.
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test, vi } from 'vitest';
import { roomBench } from './fixtures/dedicated/roomBench';
import { MemoryStorage } from './setup';

// opus-wordkeep: the world's word, kept a minute, outlives the page. `online.js` is a bundle of its own whose save store has no
// storage (OF4 found it for the release file), so a page that reloads asked the door again, and every socket counts against its
// 10 a minute per address. Each page load here is two module realms, as a page has them: the page's, with its storage installed
// (`app/identity`), and `online.js`'s, with none.
const SHARD = 'driftwood-isle';
const RELEASE = { channel: 'production', serial: 3, engineBuild: 'bench', saveEpoch: 1, shards: [{ slug: SHARD, revision: 1 }] };
afterEach(() => { vi.unstubAllGlobals(); });

type Online = typeof import('../src/client/host/online/shell');
type Page = typeof import('../src/client/game/grid/oneWayIn');
async function pageLoad(): Promise<{ readonly online: Online; readonly page: Page }> {
  vi.resetModules();
  const online = await import('../src/client/host/online/shell'); // online.js: no storage installed
  vi.resetModules();
  await import('../src/client/app/identity'); // the page's own realm installs its storage
  return { online, page: await import('../src/client/game/grid/oneWayIn') };
}
test('a word heard on one page answers the next page in the tab for a minute, without another socket', { timeout: 60_000 }, async () => {
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  const room = await roomBench({ cells: [SHARD], workers: 2 });
  let sockets = 0;
  room.server.on('upgrade', () => { sockets++; });
  const key = generateKeyPairSync('ed25519'), body = JSON.stringify({ ...RELEASE, socket: room.url });
  const text = JSON.stringify({ body, signature: sign(null, Buffer.from(body), key.privateKey).toString('hex') });
  const origin = createServer((_request, response) => { response.end(text); });
  await new Promise<void>(resolve => { origin.listen(0, '127.0.0.1', resolve); });
  const config = { release: `http://127.0.0.1:${String((origin.address() as AddressInfo).port)}/release.json`, key: key.publicKey.export({ type: 'spki', format: 'der' }).toString('hex') };
  const world = { release: config.release, key: config.key };
  // the page's read, as Shard select and a `?chunk=` page make it: online.js's worldWord, with the page's keep lent
  const heard = async ({ online, page }: { readonly online: Online; readonly page: Page }): Promise<unknown> => page.readHosted(world, 3000, () => Promise.resolve(online));
  const WORD = { grid: false, shards: [SHARD] };
  try {
    expect(await heard(await pageLoad()), 'the first page hears the door').toEqual(WORD);
    expect(sockets).toBe(1);
    expect(await heard(await pageLoad()), 'a reload answers from the kept word').toEqual(WORD);
    expect(sockets, 'no second socket within the minute').toBe(1);
    const tab = Array.from({ length: sessionStorage.length }, (_, index) => { const name = sessionStorage.key(index) ?? ''; return `${name}=${sessionStorage.getItem(name) ?? ''}`; }).join('\n');
    expect(tab, 'kept in the page\'s own session saves').toContain('gridGate');
    // the one-minute limit holds: a page a minute on asks the door again
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    expect(await heard(await pageLoad()), 'a minute on, the door is asked again').toEqual(WORD);
    expect(sockets).toBe(2);
  } finally { origin.closeAllConnections(); origin.close(); await room.close(); }
});

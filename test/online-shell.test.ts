// oxlint-disable-next-line import/no-nodejs-modules -- It signs as the promoter does.
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import type { LinkState } from '../src/client/engine/net/redial';
import { readSignedRelease } from '../src/client/host/online/release';
import { connectOnline, type OnlineShell } from '../src/client/host/online/shell';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';

// E7.2d: the page's half of the one world, on the real door and a real socket, as a page calls it. Only the strips are left out.
const SHARD = 'driftwood-isle', IDENTITY = { player: 'device:online', name: 'Jake' };
let bench: RoomBench | undefined, shell: OnlineShell | undefined, pump: ReturnType<typeof setInterval> | undefined;
afterEach(async () => { clearInterval(pump); shell?.dispose(); await bench?.close(); bench = undefined; shell = undefined; });

const signedFile = (body: unknown, key = generateKeyPairSync('ed25519')): { text: string; publicKey: string } => {
  const text = JSON.stringify(body);
  return { text: JSON.stringify({ body: text, signature: sign(null, Buffer.from(text), key.privateKey).toString('hex') }), publicKey: key.publicKey.export({ type: 'spki', format: 'der' }).toString('hex') };
};
const RELEASE = { channel: 'production', serial: 3, engineBuild: 'bench', saveEpoch: 1, shards: [{ slug: SHARD, revision: 1 }], socket: 'wss://example.trycloudflare.com/' };

test('a page believes a release file only on its signature', async () => {
  const { text, publicKey } = signedFile(RELEASE);
  await expect(readSignedRelease(text, publicKey)).resolves.toMatchObject({ engineBuild: 'bench', socket: RELEASE.socket });
  await expect(readSignedRelease(text.replace('bench', 'other'), publicKey)).rejects.toThrow('bad signature');
  await expect(readSignedRelease(text, signedFile(RELEASE).publicKey)).rejects.toThrow('bad signature');
});

test('a browser with no Ed25519 tells the player what to do', async () => {
  const { text, publicKey } = signedFile(RELEASE);
  vi.spyOn(crypto.subtle, 'importKey').mockRejectedValueOnce(new DOMException('Algorithm: Unrecognized name', 'NotSupportedError'));
  await expect(readSignedRelease(text, publicKey)).rejects.toThrow('Update it to Chrome 137');
});

test('the door seats a loaded page, a countdown reaches it, and a stale page hears `reload`', { timeout: 30_000 }, async () => {
  bench = await roomBench({ graceMs: 60_000 });
  const stale: { state: LinkState; reason?: string }[] = [];
  const old = connectOnline({ socket: bench.url, build: 'an-old-build', loaded: SHARD, identity: { player: 'device:old', name: 'Old' } }, { link: (state, reason) => { stale.push({ state, ...reason === undefined ? {} : { reason } }); }, countdown: () => undefined, elsewhere: () => undefined });
  await vi.waitFor(() => { expect(stale).toEqual([{ state: 'ended', reason: 'reload' }]); }, { timeout: 5000 });
  old.dispose();
  const countdowns: string[] = [], places: string[] = [];
  shell = connectOnline({ socket: bench.url, build: 'bench', loaded: SHARD, identity: IDENTITY }, { link: () => undefined, countdown: said => { countdowns.push(said.build); }, elsewhere: shard => { places.push(shard); } });
  const { client, booted, ready } = shell;
  pump = setInterval(() => { client.present(); client.flush(); }, 16);
  await booted;
  expect(bench.room(SHARD)?.holds(IDENTITY.player), 'no body before the page says it has loaded').toBe(false);
  ready();
  await vi.waitFor(() => { expect(client.welcome).not.toBeNull(); expect(bench?.room(SHARD)?.holds(IDENTITY.player)).toBe(true); }, { timeout: 5000 });
  bench.world.beginGrace('next-build');
  await vi.waitFor(() => { expect(countdowns).toEqual(['next-build']); });
  expect(places, 'this page has the cell its seat is in').toEqual([]);
});

test('a seat in a cell the page has not loaded says so, and takes no body', { timeout: 30_000 }, async () => {
  bench = await roomBench();
  const places: string[] = [];
  shell = connectOnline({ socket: bench.url, build: 'bench', loaded: 'nalati-grasslands', identity: IDENTITY }, { link: () => undefined, countdown: () => undefined, elsewhere: shard => { places.push(shard); } });
  await vi.waitFor(() => { expect(places).toEqual([SHARD]); }, { timeout: 5000 });
  expect(bench.room(SHARD)?.holds(IDENTITY.player)).toBe(false);
});

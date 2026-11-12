// oxlint-disable-next-line import/no-nodejs-modules -- It signs as the promoter does.
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import type { LinkState } from '../src/client/engine/net/redial';
import { readSignedRelease } from '../src/client/host/online/release';
import { connectOnline, worldHostsGrid, type OnlineShell } from '../src/client/host/online/shell';
import { hostsGrid } from '../src/client/game/shardfile/serverRoute';
// oxlint-disable-next-line import/no-nodejs-modules -- The release file's own origin.
import { createServer, type Server } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Its port.
import type { AddressInfo } from 'node:net';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { World } from '../src/server/host/dedicated/world';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { cellFrame } from '../src/server/host/dedicated/gridCells';
import { GridAssembly } from '../src/shared/game/grid/assembly';

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

test('the door seats a loaded page, a countdown reaches it, and another build of this wire is not refused', { timeout: 30_000 }, async () => {
  bench = await roomBench({ graceMs: 60_000 });
  const stale: { state: LinkState; reason?: string }[] = [];
  const old = connectOnline({ socket: bench.url, build: 'an-old-build', loaded: SHARD, identity: { player: 'device:old', name: 'Old' } }, { link: (state, reason) => { stale.push({ state, ...reason === undefined ? {} : { reason } }); }, countdown: () => undefined, elsewhere: () => undefined });
  // WR5 (5.5, J54 replaced): builds need not match; the wire's bootstrap and minor window decide.
  await new Promise(resolve => { setTimeout(resolve, 1500); });
  expect(stale).toEqual([]);
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

test('GO4: a grid page in its seat\'s cell takes its body there; a seat in another cell re-enters the grid, never a `?chunk=` page', { timeout: 60_000 }, async () => {
  const saves = memoryPlayerSaves();
  saves.write({ player: IDENTITY.player, name: 'Jake', shard: '_template', cell: 'template-2', build: 'bench', saveVersion: 0, seq: 1, reason: 'test', doc: null, receipts: [] });
  bench = await roomBench({ cells: [SHARD, 'template-2'], workers: 2, saves });
  const reloads: string[] = [], regrids: string[] = [], placed: { cell: string; at: unknown }[] = [];
  const view = { link: (): void => undefined, countdown: (): void => undefined, elsewhere: (shard: string): void => { reloads.push(shard); }, placed: (cell: string, at: unknown): void => { placed.push({ cell, at }); }, regrid: (cell: string): void => { regrids.push(cell); } };
  const away = connectOnline({ socket: bench.url, build: 'bench', loaded: SHARD, identity: IDENTITY, gridCell: SHARD }, view);
  await vi.waitFor(() => { expect(regrids).toEqual(['template-2']); }, { timeout: 5000 });
  expect(placed).toEqual([{ cell: 'template-2', at: expect.objectContaining({ x: expect.any(Number), z: expect.any(Number) }) as unknown }]);
  expect(reloads, 'no `?chunk=` reload').toEqual([]);
  expect(bench.room('template-2')?.holds(IDENTITY.player), 'no body while the page goes').toBe(false);
  away.dispose();
  shell = connectOnline({ socket: bench.url, build: 'bench', loaded: '_template', identity: IDENTITY, gridCell: 'template-2' }, view);
  const { client, booted, ready } = shell;
  pump = setInterval(() => { client.present(); client.flush(); }, 16);
  await booted;
  ready();
  await vi.waitFor(() => { expect(bench?.room('template-2')?.holds(IDENTITY.player)).toBe(true); }, { timeout: 5000 });
  await vi.waitFor(() => { expect(client.latest?.cell).toBe(cellFrame('template-2')); }, { timeout: 5000 });
  expect({ regrids, reloads }).toEqual({ regrids: ['template-2'], reloads: [] });
});

test('GO4: a held seat in another cell (no `resume`, only frames) re-enters the grid there too', { timeout: 60_000 }, async () => {
  const saves = memoryPlayerSaves(), cells = new GridAssembly({ developer: false, devserver: false }).cells.map(cell => cell.instance);
  saves.write({ player: IDENTITY.player, name: 'Jake', shard: '_template', cell: 'template-2', build: 'bench', saveVersion: 0, seq: 1, reason: 'test', doc: null, receipts: [] });
  bench = await roomBench({ cells: [SHARD, 'template-2'], workers: 2, saves, holdMs: 30_000 });
  const regrids: string[] = [], view = { link: (): void => undefined, countdown: (): void => undefined, elsewhere: (): void => undefined, regrid: (cell: string): void => { regrids.push(cell); } };
  const first = connectOnline({ socket: bench.url, build: 'bench', loaded: '_template', identity: IDENTITY, gridCell: 'template-2', gridCells: cells }, view);
  pump = setInterval(() => { first.client.present(); first.client.flush(); }, 16);
  await first.booted; first.ready();
  await vi.waitFor(() => { expect(bench?.room('template-2')?.holds(IDENTITY.player)).toBe(true); expect(first.client.latest).not.toBeNull(); }, { timeout: 5000 });
  clearInterval(pump); first.dispose();
  shell = connectOnline({ socket: bench.url, build: 'bench', loaded: SHARD, identity: IDENTITY, gridCell: SHARD, gridCells: cells }, view);
  await vi.waitFor(() => { expect(regrids).toEqual(['template-2']); }, { timeout: 5000 });
});

test('a seated page that leaves takes its body with it at once', { timeout: 30_000 }, async () => {
  bench = await roomBench();
  shell = connectOnline({ socket: bench.url, build: 'bench', loaded: SHARD, identity: IDENTITY }, { link: () => undefined, countdown: () => undefined, elsewhere: () => undefined });
  const { client, booted, ready, leave } = shell;
  pump = setInterval(() => { client.present(); client.flush(); }, 16);
  await booted;
  ready();
  await vi.waitFor(() => { expect(bench?.room(SHARD)?.holds(IDENTITY.player)).toBe(true); }, { timeout: 5000 });
  await leave();
  await vi.waitFor(() => { expect(bench?.room(SHARD)?.holds(IDENTITY.player)).toBe(false); expect(bench?.world.health().players).toBe(0); }, { timeout: 3000 });
});

test('a page that leaves while it loads never takes a seat', { timeout: 30_000 }, async () => {
  bench = await roomBench();
  shell = connectOnline({ socket: bench.url, build: 'bench', loaded: SHARD, identity: IDENTITY }, { link: () => undefined, countdown: () => undefined, elsewhere: () => undefined });
  const { client, booted, ready, leave } = shell;
  pump = setInterval(() => { client.present(); client.flush(); }, 16);
  await booted;
  void leave();
  ready();
  await new Promise(resolve => { setTimeout(resolve, 1000); });
  expect(bench.room(SHARD)?.holds(IDENTITY.player)).toBe(false);
  expect(bench.world.health().players).toBe(0);
});

test('a quit in the same read as the page\'s `ready` takes no seat', { timeout: 30_000 }, async () => {
  bench = await roomBench();
  shell = connectOnline({ socket: bench.url, build: 'bench', loaded: SHARD, identity: IDENTITY }, { link: () => undefined, countdown: () => undefined, elsewhere: () => undefined });
  const { client, booted, ready, leave } = shell;
  pump = setInterval(() => { client.present(); client.flush(); }, 16);
  await booted;
  // Both go in one tick, so one socket read usually takes both. The door's seat order is watched, so a body seated and dropped fails too.
  const seats = vi.spyOn(World.prototype as unknown as { seat: (...args: unknown[]) => void }, 'seat');
  ready(); void leave();
  await new Promise(resolve => { setTimeout(resolve, 1000); });
  expect(seats, 'the door never seats a player who quit').not.toHaveBeenCalled();
  expect(bench.world.health().players).toBe(0);
});

test('a quit on the link that came back for a held body ends the hold at once', { timeout: 30_000 }, async () => {
  bench = await roomBench();
  const first = connectOnline({ socket: bench.url, build: 'bench', loaded: SHARD, identity: IDENTITY }, { link: () => undefined, countdown: () => undefined, elsewhere: () => undefined });
  pump = setInterval(() => { first.client.present(); first.client.flush(); }, 16);
  await first.booted;
  first.ready();
  await vi.waitFor(() => { expect(bench?.room(SHARD)?.holds(IDENTITY.player)).toBe(true); }, { timeout: 5000 });
  clearInterval(pump); first.dispose();
  await new Promise(resolve => { setTimeout(resolve, 500); });
  expect(bench.room(SHARD)?.holds(IDENTITY.player), 'a lost link holds its body (J114)').toBe(true);
  shell = connectOnline({ socket: bench.url, build: 'bench', loaded: SHARD, identity: IDENTITY }, { link: () => undefined, countdown: () => undefined, elsewhere: () => undefined });
  void shell.leave();
  await vi.waitFor(() => { expect(bench?.room(SHARD)?.holds(IDENTITY.player)).toBe(false); expect(bench?.world.health().players).toBe(0); }, { timeout: 3000 });
});

test('a quit while the link is down and redialling still lets the held body go', { timeout: 30_000 }, async () => {
  bench = await roomBench();
  const links: LinkState[] = [];
  shell = connectOnline({ socket: bench.url, build: 'bench', loaded: SHARD, identity: IDENTITY }, { link: state => { links.push(state); }, countdown: () => undefined, elsewhere: () => undefined });
  const { client, booted, ready, leave } = shell;
  pump = setInterval(() => { client.present(); client.flush(); }, 16);
  await booted;
  ready();
  await vi.waitFor(() => { expect(bench?.room(SHARD)?.holds(IDENTITY.player)).toBe(true); }, { timeout: 5000 });
  // The door drops the link the way a stalled phone's is dropped: the body is held (J114) and the page starts redialling.
  for (const end of (bench.world as unknown as { ends: Set<{ close: (reason: string) => void }> }).ends) end.close('stalled');
  // The page has heard the close and is redialling: the quit below is said while the link is down, not on the dropped one.
  await vi.waitFor(() => { expect(links).toContain('reconnecting'); }, { timeout: 3000 });
  expect(bench.room(SHARD)?.holds(IDENTITY.player), 'a lost link holds its body').toBe(true);
  await leave();
  await vi.waitFor(() => { expect(bench?.room(SHARD)?.holds(IDENTITY.player)).toBe(false); expect(bench?.world.health().players).toBe(0); }, { timeout: 3000 });
});

test('a quit said on a link the door has dropped, before the page hears the close, still lets the held body go', { timeout: 30_000 }, async () => {
  bench = await roomBench();
  shell = connectOnline({ socket: bench.url, build: 'bench', loaded: SHARD, identity: IDENTITY }, { link: () => undefined, countdown: () => undefined, elsewhere: () => undefined });
  const { client, booted, ready, leave } = shell;
  pump = setInterval(() => { client.present(); client.flush(); }, 16);
  await booted;
  ready();
  await vi.waitFor(() => { expect(bench?.room(SHARD)?.holds(IDENTITY.player)).toBe(true); }, { timeout: 5000 });
  // ci 43165862958: the door dropped the link and the quit went out on it in the same turn, before its close frame reached the
  // page. The door never heard it, and the body stood for J114's 30 s.
  for (const end of (bench.world as unknown as { ends: Set<{ close: (reason: string) => void }> }).ends) end.close('stalled');
  await leave();
  await vi.waitFor(() => { expect(bench?.room(SHARD)?.holds(IDENTITY.player)).toBe(false); expect(bench?.world.health().players).toBe(0); }, { timeout: 3000 });
});

test('GO4 gate: a world with Driftwood alone does not host the grid; one with more cells does; an unreachable world answers no', { timeout: 60_000 }, async () => {
  const servers: Server[] = [];
  const asked = async (cells: readonly string[]): Promise<boolean> => {
    const room = await roomBench({ cells, workers: 2 });
    // The rooms address as D7 has it (MS5.1): Caddy passes only the socket upgrade, so `/health` and everything else is a 404 with no
    // CORS. A gate that reads `/health` answers no here, and the grid page stays one-shard.
    room.server.on('request', (_request, response) => { response.writeHead(404).end(); });
    const { text, publicKey } = signedFile({ ...RELEASE, socket: room.url }), origin = createServer((_request, response) => { response.end(text); });
    servers.push(origin);
    await new Promise<void>(resolve => { origin.listen(0, '127.0.0.1', resolve); });
    try { return await worldHostsGrid({ release: `http://127.0.0.1:${String((origin.address() as AddressInfo).port)}/release.json`, key: publicKey }, hostsGrid); }
    finally { await room.close(); }
  };
  try {
    expect(await asked([SHARD]), 'WORLD_CELLS unset: the solo grid').toBe(false);
    expect(await asked([SHARD, 'template-2']), 'the world hosts the grid').toBe(true);
    expect(await worldHostsGrid({ release: 'http://127.0.0.1:9/release.json', key: signedFile(RELEASE).publicKey }, hostsGrid, 500), 'unreachable: solo').toBe(false);
    const stalled = createServer(() => undefined);
    servers.push(stalled);
    await new Promise<void>(resolve => { stalled.listen(0, '127.0.0.1', resolve); });
    const begun = performance.now();
    expect(await worldHostsGrid({ release: `http://127.0.0.1:${String((stalled.address() as AddressInfo).port)}/release.json`, key: signedFile(RELEASE).publicKey }, hostsGrid, 500), 'a stalled release file: solo').toBe(false);
    expect(performance.now() - begun, 'within the one deadline').toBeLessThan(1500);
    const { text, publicKey } = signedFile({ ...RELEASE, socket: `ws://127.0.0.1:${String((stalled.address() as AddressInfo).port)}/` }), origin = createServer((_request, response) => { response.end(text); });
    servers.push(origin);
    await new Promise<void>(resolve => { origin.listen(0, '127.0.0.1', resolve); });
    expect(await worldHostsGrid({ release: `http://127.0.0.1:${String((origin.address() as AddressInfo).port)}/release.json`, key: publicKey }, hostsGrid, 500), 'a socket that never opens: solo').toBe(false);
  } finally { for (const server of servers) { server.closeAllConnections(); server.close(); } }
});

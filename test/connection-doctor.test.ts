// oxlint-disable-next-line import/no-nodejs-modules -- It signs as the promoter does and serves the page's origin.
import { generateKeyPairSync, sign } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- the page's origin and the packs origin, as real HTTP
import { createServer, type Server } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- the origin's port, as roomBench reads its own
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { doctorReport, healthUrl, runDoctor, type DoctorConfig, type DoctorRow } from '../src/client/host/online/doctor';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';

// E7.5 prep: the Connection doctor against a real door on a real socket, and a real origin for the page, the release file and the packs.
const SHARD = 'driftwood-isle', PART = '/assets/spawn/server/0123456789abcdef.pack.br';
let bench: RoomBench | undefined, origin: Server | undefined;
const owner = new Scope('doctor test');
afterEach(async () => {
  await bench?.close(); bench = undefined;
  const served = origin; origin = undefined;
  if (served !== undefined) { served.closeAllConnections(); await new Promise(resolve => { served.close(resolve); }); }
});

const key = generateKeyPairSync('ed25519'), otherKey = generateKeyPairSync('ed25519');
const publicHex = (pair: typeof key): string => pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
const signed = (body: unknown, by = key): string => { const text = JSON.stringify(body); return JSON.stringify({ body: text, signature: sign(null, Buffer.from(text), by.privateKey).toString('hex') }); };

/** The page's origin, which also plays the packs origin: version.json, the release file, the server book and its one part. */
async function serveOrigin(release: string, missingPart = false): Promise<string> {
  origin = createServer((request, response) => {
    const path = request.url ?? '';
    const body = path === '/version.json' ? JSON.stringify({ build: 'bench', saveEpoch: 1 }) : path === '/release.json' ? release
      : path === '/assets/spawn/server-bench.json' ? JSON.stringify({ book: 'server', build: 'bench', shards: { [SHARD]: { url: PART } } })
      : path === PART && !missingPart ? 'part' : null;
    response.writeHead(body === null ? 404 : 200, { 'content-type': 'application/json' }).end(body ?? '');
  });
  await new Promise<void>(resolve => { origin?.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${String((origin.address() as AddressInfo).port)}`;
}
/** The door's `/health`, as `src/server/host/dedicated/main.ts` answers it. */
const answerHealth = (room: RoomBench): void => {
  room.server.on('request', (_request, response) => { response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end(JSON.stringify({ ...room.world.health(), serial: 1, uptime: 60, now: Date.now() })); });
};
const releaseFor = (socket: string, build = 'bench'): object => ({ channel: 'production', serial: 1, engineBuild: build, saveEpoch: 1, shards: [{ slug: SHARD, revision: 1 }], socket });
const run = async (config: DoctorConfig): Promise<Record<string, DoctorRow>> => Object.fromEntries((await runDoctor(config, owner, () => undefined)).map(row => [row.id, row]));
const config = (page: string, extra: Partial<DoctorConfig> = {}): DoctorConfig => ({ build: 'bench', origin: page, world: { release: `${page}/release.json`, key: publicHex(key) }, cell: SHARD, limitMs: 3000, ...extra });

test('a healthy world passes every link and the doctor takes no seat', { timeout: 30_000 }, async () => {
  bench = await roomBench(); answerHealth(bench);
  const page = await serveOrigin(signed(releaseFor(bench.url)));
  const rows = await run(config(page));
  for (const id of ['page', 'release', 'packs', 'server', 'join', 'latency']) expect(rows[id]?.state, `${id}: ${rows[id]?.value ?? ''} ${rows[id]?.hint ?? ''}`).toBe('pass');
  expect(rows['join']?.value).toContain(`accepted · ${SHARD}`);
  expect(rows['latency']?.value).toMatch(/^\d+(?:\.\d)? ms \(min \d+(?:\.\d)?\) · clock [+−]\d+\.\d s$/u);
  expect(bench.world.health().players, 'no body seated: the doctor never says ready').toBe(0);
  const report = doctorReport(Object.values(rows), config(page));
  expect(report).toContain('Wildshard connection doctor');
  expect(report).toContain('  5. join · pass');
});

test('a release file signed by another key fails on its signature and the rest wait for it', { timeout: 30_000 }, async () => {
  bench = await roomBench();
  const rows = await run(config(await serveOrigin(signed(releaseFor(bench.url), otherKey))));
  expect(rows['page']?.state).toBe('pass');
  expect(rows['release']).toMatchObject({ state: 'fail', value: 'bad signature' });
  expect(rows['release']?.hint).toContain('pinned key');
  for (const id of ['packs', 'server', 'join']) expect(rows[id]?.state).toBe('skip');
});

test('a server that is down fails health and the socket, with the tunnel hint', { timeout: 30_000 }, async () => {
  bench = await roomBench();
  const socket = bench.url;
  await bench.close(); bench = undefined;
  const rows = await run(config(await serveOrigin(signed(releaseFor(socket)))));
  expect(rows['release']?.state).toBe('pass');
  expect(rows['server']?.state).toBe('fail');
  expect(rows['server']?.hint).toContain('Server unreachable: the VPS tunnel');
  expect(rows['join']?.state).toBe('fail');
  expect(rows['latency']?.state).toBe('skip');
});

test('the door says why it refuses: a full world, and another build', { timeout: 30_000 }, async () => {
  bench = await roomBench({ seats: 0 }); answerHealth(bench);
  const page = await serveOrigin(signed(releaseFor(bench.url)));
  expect((await run(config(page)))['join']).toMatchObject({ state: 'fail', value: 'World is full' });
  const stale = await run(config(page, { build: 'an-old-build' }));
  expect(stale['release']?.state, 'the world names another build').toBe('warn');
  expect(stale['join']).toMatchObject({ state: 'fail', value: 'refused: another build' });
});

test('a missing pack part and a missing book are the packs origin, not the server', { timeout: 30_000 }, async () => {
  bench = await roomBench(); answerHealth(bench);
  const rows = await run(config(await serveOrigin(signed(releaseFor(bench.url)), true)));
  expect(rows['packs']).toMatchObject({ state: 'fail', value: `${SHARD} part 404` });
  expect(rows['join']?.state).toBe('pass');
});

test('the health address sits beside the socket', () => {
  expect(healthUrl('wss://wildshard.tailb41b20.ts.net')).toBe('https://wildshard.tailb41b20.ts.net/health');
  expect(healthUrl('wss://wildshard.tailb41b20.ts.net:8443/')).toBe('https://wildshard.tailb41b20.ts.net:8443/health');
  expect(healthUrl('ws://127.0.0.1:18797/')).toBe('http://127.0.0.1:18797/health');
});

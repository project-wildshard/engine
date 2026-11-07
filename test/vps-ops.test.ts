// oxlint-disable-next-line import/no-nodejs-modules -- These run the real scripts as the VPS does.
import { execFileSync, spawn } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- A release is signed by a real key.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- These run the real scripts as the VPS does.
import { once } from 'node:events';
// oxlint-disable-next-line import/no-nodejs-modules -- The folders the VPS keeps.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A local stand-in for R2 and the phone's alert.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import type { AddressInfo } from 'node:net';
// oxlint-disable-next-line import/no-nodejs-modules -- The folders the VPS keeps.
import { join, resolve as absolute } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { readReleaseFile } from '../src/server/host/dedicated/releaseFile';

// E7.2c and E7.8c, at their outer edge: `pull.mjs` and `uptime.sh` as systemd runs them, against a local origin.
const PULL = absolute(process.env['WS_VPS_PULL'] ?? 'scripts/vps/pull.mjs'), UPTIME = absolute('scripts/vps/uptime.sh');
const { publicKey, privateKey } = generateKeyPairSync('ed25519'), KEY = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
const cleanups: (() => void)[] = [];
afterEach(() => { for (const clean of cleanups.splice(0).reverse()) clean(); });

function folder(): string { const root = absolute('tmp/vps-ops'); mkdirSync(root, { recursive: true }); const made = mkdtempSync(join(root, 'vps-ops-')); cleanups.push(() => { rmSync(made, { recursive: true, force: true }); }); return made; }
/** A server on a free port, gone after the test. */
async function serve(answer: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(answer);
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  cleanups.push(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}
interface Run { readonly code: number; readonly out: string }
async function run(file: string, args: readonly string[], env: Record<string, string>): Promise<Run> {
  const child = spawn(file, [...args], { env: { ...process.env, ...env } });
  let out = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk: Buffer) => { out += chunk.toString(); });
  const [code] = await once(child, 'close') as [number];
  return { code, out };
}

/** A real bundle: a tar.gz holding a `main.mjs` that says which build it is. */
function bundle(root: string, build: string): { readonly name: string; readonly sha256: string; readonly bytes: Buffer } {
  const source = join(root, `source-${build}`), name = `${build}.tar.gz`, archive = join(root, name);
  mkdirSync(source);
  writeFileSync(join(source, 'bundle.json'), JSON.stringify({ engineBuild: build }));
  writeFileSync(join(source, 'main.mjs'), `console.log(${JSON.stringify(build)});\n`);
  execFileSync('tar', ['-czf', archive, '-C', source, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const bytes = readFileSync(archive);
  return { name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes };
}
const signed = (body: string, key = privateKey): string => JSON.stringify({ body, signature: sign(null, Buffer.from(body), key).toString('hex') });
const release = (serial: number, build: string, made: { readonly name: string; readonly sha256: string }): string => signed(JSON.stringify({ channel: 'production', serial, engineBuild: build, saveEpoch: 1, shards: [{ slug: 'driftwood-isle', revision: 1 }], bundle: { name: made.name, sha256: made.sha256 } }));

test.each([false, true])('an interrupted bundle publication retries with an existing installation: %s', async installed => {
  const root = folder(), home = join(root, 'home'), one = bundle(root, 'before'), two = bundle(root, 'interrupted');
  let text = release(1, 'before', one);
  const origin = await serve((request, response) => { response.end(request.url === '/release.json' ? text : request.url === '/before.tar.gz' ? one.bytes : two.bytes); });
  const env = { RELEASE_URL: `${origin}/release.json`, RELEASE_PUBLIC_KEY: KEY, BUNDLE_ORIGIN: origin, WILDSHARD_HOME: home };
  const pull = (...args: string[]): Promise<Run> => run(process.execPath, [PULL, ...args], env);
  if (installed) expect((await pull()).code).toBe(0);
  text = release(2, 'interrupted', two);
  expect((await pull('--fetch')).code).toBe(0);
  const target = join(home, 'bundles', 'interrupted'); rmSync(join(target, 'release.json'));
  expect((await pull('--fetch')).code, 'a checked, unpublished bundle can finish its kept record').toBe(0);
  expect(readFileSync(join(target, 'release.json'), 'utf8')).toBe(text);
  expect((await pull()).code).toBe(0); expect(readlinkSync(join(home, 'current'))).toBe(target);
});

test('the pull moves to a good bundle; a bad hash, a bad signature or an old release moves nothing', async () => {
  const root = folder(), home = join(root, 'home'), one = bundle(root, 'b1'), two = bundle(root, 'b2'), files = new Map<string, Buffer | string>([['/b1.tar.gz', one.bytes], ['/b2.tar.gz', two.bytes]]);
  const origin = await serve((request, response) => { const file = files.get(request.url ?? ''); if (file === undefined) response.writeHead(404).end(); else response.end(file); });
  const env = { RELEASE_URL: `${origin}/release.json`, RELEASE_PUBLIC_KEY: KEY, BUNDLE_ORIGIN: origin, WILDSHARD_HOME: home };
  const live = (): string => readlinkSync(join(home, 'current')), pull = (...args: string[]): Promise<Run> => run(process.execPath, [PULL, ...args], env);

  files.set('/release.json', release(1, 'b1', { ...two, name: one.name }));
  expect((await pull()).code, 'a first pull with no good bundle stops the service').toBe(1);
  expect(existsSync(join(home, 'current'))).toBe(false);

  files.set('/release.json', release(2, 'b1', one));
  expect((await pull()).code).toBe(0);
  expect(live()).toBe(join(home, 'bundles', 'b1'));
  const kept = readFileSync(join(live(), 'release.json'), 'utf8');
  expect(readReleaseFile(kept, KEY), 'the server reads what the pull kept').toMatchObject({ serial: 2, bundle: { name: one.name, sha256: one.sha256 } });

  files.set('/release.json', release(3, 'b2', { ...two, sha256: one.sha256 }));
  const bad = await pull('--fetch');
  expect(bad.code, 'before the grace: no countdown').toBe(1);
  expect(bad.out).toContain('bad hash');
  expect((await pull()).code, 'at a restart: the old bundle comes back up').toBe(0);
  expect(live()).toBe(join(home, 'bundles', 'b1'));
  expect(existsSync(join(home, 'bundles', 'b2'))).toBe(false);
  expect(readFileSync(join(live(), 'release.json'), 'utf8'), 'and it still holds the file that named it').toBe(kept);

  const stranger = generateKeyPairSync('ed25519').privateKey;
  files.set('/release.json', signed(JSON.stringify({ channel: 'production', serial: 4, engineBuild: 'b2', saveEpoch: 1, shards: [{ slug: 'driftwood-isle', revision: 1 }], bundle: { name: two.name, sha256: two.sha256 } }), stranger));
  expect((await pull()).code).toBe(0);
  expect(live()).toBe(join(home, 'bundles', 'b1'));

  files.set('/release.json', release(5, 'b2', two));
  expect((await pull('--fetch')).code).toBe(0);
  expect(live(), 'a fetch moves nothing').toBe(join(home, 'bundles', 'b1'));
  expect(existsSync(join(home, 'bundles', 'b2', 'main.mjs'))).toBe(true);
  expect((await pull()).code).toBe(0);
  expect(live()).toBe(join(home, 'bundles', 'b2'));

  files.set('/release.json', release(4, 'b1', one));
  expect((await pull()).code, 'we only fix forward: the old file is refused, and the server stays up').toBe(0);
  expect(live()).toBe(join(home, 'bundles', 'b2'));
});

test('a stopped server tells the phone once, and once more when it is back', async () => {
  const told: string[] = [];
  let up = true, sending = true;
  const health = await serve((_request, response) => { response.writeHead(up ? 200 : 503).end(); });
  const alert = await serve((request, response) => {
    let line = '';
    request.on('data', (chunk: Buffer) => { line += chunk.toString(); });
    request.on('end', () => { if (sending) told.push(line); response.writeHead(sending ? 200 : 500).end(); });
  });
  const env = { HEALTH_URL: `${health}/health`, UPTIME_STATE: join(folder(), 'uptime.state'), ALERT_URL: alert };
  const check = (): Promise<Run> => run('bash', [UPTIME], env);

  await check();
  up = false;
  await check();
  expect(told, 'one miss is a restart').toEqual([]);
  sending = false;
  await check();
  sending = true;
  await check();
  await check();
  expect(told, 'the failed send went again, and only once').toHaveLength(1);
  expect(told[0]).toContain('down');
  up = true;
  await check();
  await check();
  expect(told).toHaveLength(2);
  expect(told[1]).toContain('back');
});

test('signed invalid metadata and cached hash changes never replace the kept release', async () => {
  const root = folder(), home = join(root, 'home'), one = bundle(root, 'safe');
  let text = release(10, 'safe', one);
  const origin = await serve((request, response) => { response.end(request.url === '/release.json' ? text : one.bytes); });
  const env = { RELEASE_URL: `${origin}/release.json`, RELEASE_PUBLIC_KEY: KEY, BUNDLE_ORIGIN: origin, WILDSHARD_HOME: home };
  const pull = (...args: string[]): Promise<Run> => run(process.execPath, [PULL, ...args], env);
  expect((await pull()).code).toBe(0);
  const file = join(home, 'current', 'release.json'), kept = readFileSync(file, 'utf8');
  const base = { channel: 'production', serial: 11, engineBuild: 'safe', saveEpoch: 1, shards: [{ slug: 'driftwood-isle', revision: 1 }], bundle: { name: one.name, sha256: one.sha256 } };
  for (const invalid of [{ saveEpoch: null }, { channel: 'other' }, { channel: 'staging' }, { shards: 'broken' }, { shards: [{ slug: 'x', revision: -1 }] }, { socket: 12 }, { serial: -1 }]) {
    text = signed(JSON.stringify({ ...base, ...invalid }));
    expect((await pull('--fetch')).code, JSON.stringify(invalid)).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe(kept);
  }
  text = signed(JSON.stringify({ ...base, serial: 10, saveEpoch: 9 }));
  expect((await pull('--fetch')).code, 'a conflicting equal serial').toBe(1);
  expect(readFileSync(file, 'utf8')).toBe(kept);
  text = release(12, 'safe', { ...one, sha256: '0'.repeat(64) });
  expect((await pull('--fetch')).code, 'an existing folder cannot bypass the signed digest').toBe(1);
  expect(readFileSync(file, 'utf8')).toBe(kept);
});

test('a signed release missing an open cell cannot activate', async () => {
  const root = folder(), home = join(root, 'home'), one = bundle(root, 'cell-check');
  const text = signed(JSON.stringify({ channel: 'production', serial: 1, engineBuild: 'cell-check', saveEpoch: 1, shards: [], bundle: { name: one.name, sha256: one.sha256 } })), origin = await serve((request, response) => { response.end(request.url === '/release.json' ? text : one.bytes); });
  const result = await run(process.execPath, [PULL, '--fetch'], { RELEASE_URL: `${origin}/release.json`, RELEASE_PUBLIC_KEY: KEY, BUNDLE_ORIGIN: origin, WILDSHARD_HOME: home, WORLD_CELLS: 'driftwood-isle' });
  expect(result.code).toBe(1); expect(existsSync(join(home, 'current'))).toBe(false);
});

test('a bundle built for a different engine cannot activate', async () => {
  const root = folder(), home = join(root, 'home'), one = bundle(root, 'actual-build');
  const text = release(1, 'claimed-build', one), origin = await serve((request, response) => { response.end(request.url === '/release.json' ? text : one.bytes); });
  const result = await run(process.execPath, [PULL], { RELEASE_URL: `${origin}/release.json`, RELEASE_PUBLIC_KEY: KEY, BUNDLE_ORIGIN: origin, WILDSHARD_HOME: home });
  expect(result.code).toBe(1); expect(existsSync(join(home, 'current'))).toBe(false);
});

test('a prefetched target cannot roll back its kept serial', async () => {
  const root = folder(), home = join(root, 'home'), one = bundle(root, 'live'), two = bundle(root, 'prefetched'); let text = release(10, 'live', one);
  const origin = await serve((request, response) => { response.end(request.url === '/release.json' ? text : request.url === `/${one.name}` ? one.bytes : two.bytes); });
  const env = { RELEASE_URL: `${origin}/release.json`, RELEASE_PUBLIC_KEY: KEY, BUNDLE_ORIGIN: origin, WILDSHARD_HOME: home };
  expect((await run(process.execPath, [PULL], env)).code).toBe(0);
  text = release(12, 'prefetched', two); expect((await run(process.execPath, [PULL, '--fetch'], env)).code).toBe(0);
  const path = join(home, 'bundles', 'prefetched', 'release.json'), kept = readFileSync(path, 'utf8');
  text = release(11, 'prefetched', two); expect((await run(process.execPath, [PULL, '--fetch'], env)).code).toBe(1);
  expect(readFileSync(path, 'utf8')).toBe(kept);
});

test('an unreadable installed release cannot fail open to an older file', async () => {
  const root = folder(), home = join(root, 'home'), one = bundle(root, 'kept'); let text = release(10, 'kept', one);
  const origin = await serve((request, response) => { response.end(request.url === '/release.json' ? text : one.bytes); });
  const env = { RELEASE_URL: `${origin}/release.json`, RELEASE_PUBLIC_KEY: KEY, BUNDLE_ORIGIN: origin, WILDSHARD_HOME: home };
  expect((await run(process.execPath, [PULL], env)).code).toBe(0);
  const path = join(home, 'current', 'release.json'); writeFileSync(path, 'damaged');
  text = release(3, 'kept', one); expect((await run(process.execPath, [PULL, '--fetch'], env)).code).toBe(1);
  expect(readFileSync(path, 'utf8')).toBe('damaged');
});

test('a cached completion without its server entry is refused', async () => {
  const root = folder(), home = join(root, 'home'), one = bundle(root, 'entry'); let text = release(1, 'entry', one);
  const origin = await serve((request, response) => { response.end(request.url === '/release.json' ? text : one.bytes); });
  const env = { RELEASE_URL: `${origin}/release.json`, RELEASE_PUBLIC_KEY: KEY, BUNDLE_ORIGIN: origin, WILDSHARD_HOME: home };
  expect((await run(process.execPath, [PULL], env)).code).toBe(0);
  rmSync(join(home, 'current', 'main.mjs')); text = release(2, 'entry', one);
  expect((await run(process.execPath, [PULL, '--fetch'], env)).code).toBe(1);
});

test('failure to create a replacement keeps the old release intact', async () => {
  const root = folder(), home = join(root, 'home'), one = bundle(root, 'atomic'); let text = release(1, 'atomic', one);
  const origin = await serve((request, response) => { response.end(request.url === '/release.json' ? text : one.bytes); });
  const env = { RELEASE_URL: `${origin}/release.json`, RELEASE_PUBLIC_KEY: KEY, BUNDLE_ORIGIN: origin, WILDSHARD_HOME: home };
  expect((await run(process.execPath, [PULL], env)).code).toBe(0);
  const directory = join(home, 'bundles', 'atomic'), file = join(directory, 'release.json'), kept = readFileSync(file, 'utf8');
  chmodSync(directory, 0o500);
  try { text = release(2, 'atomic', one); expect((await run(process.execPath, [PULL, '--fetch'], env)).code).toBe(1); expect(readFileSync(file, 'utf8')).toBe(kept); }
  finally { chmodSync(directory, 0o700); }
});

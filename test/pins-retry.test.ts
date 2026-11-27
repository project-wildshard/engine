// Meta QA 11-25 row 39 (J505): engine CI's pins install went red on one 503 for a pinned Nalati asset, the second infra
// failure there after 11-24's mirror 404 (run 45404606407). Pins install now tries a 5xx again (3 tries over about
// 30 s), a mirror 404 falls back to the API, and a final failure names every URL it could not fetch.
// SF10 retired the public-asset pins (pin-assets.ts), so only the shardfile pin cases remain here.
// oxlint-disable-next-line import/no-nodejs-modules -- pins.ts runs as its CLI against a local fake server.
import { spawn } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Pins are proved by their hashes.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The fake mirror, API and GitHub are one local server.
import { createServer, type IncomingMessage, type Server } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture trees.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture trees.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';

const servers: Server[] = [], folders: string[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A local server answering each path from a script of status codes; a 200 serves `body`. */
async function fakeServer(body: Buffer, script: Record<string, number[]>): Promise<{ base: string; seen: IncomingMessage[] }> {
  const seen: IncomingMessage[] = [];
  const server = createServer((request, response) => {
    seen.push(request);
    const path = (request.url ?? '').split('?')[0] ?? '';
    const status = script[path]?.shift() ?? 404;
    response.statusCode = status;
    response.end(status === 200 ? body : '');
  });
  servers.push(server);
  await new Promise<void>(done => { server.listen(0, '127.0.0.1', () => { done(); }); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No fixture port');
  return { base: `http://127.0.0.1:${String(address.port)}`, seen };
}

/** pins.ts's stderr once it exits. */
const pinsTool = (cwd: string, env: NodeJS.ProcessEnv, ...args: readonly string[]): Promise<string> => new Promise(done => {
  const child = spawn(process.execPath, [resolve('src/scripts/pins.ts'), ...args], { cwd, env });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  child.on('close', () => { done(stderr); });
});

/** One pinned shardfile; the fake server is both the mirror (/mirror) and the API. */
async function shardTree(script: (hash: string) => Record<string, number[]>): Promise<{ root: string; env: NodeJS.ProcessEnv; hash: string; seen: IncomingMessage[]; base: string }> {
  const body = Buffer.from('a pinned tarball'), hash = createHash('sha256').update(body).digest('hex');
  const { base, seen } = await fakeServer(body, script(hash));
  const root = mkdtempSync(join(tmpdir(), 'pins-retry-'));
  folders.push(root);
  mkdirSync(join(root, 'test/pins'), { recursive: true });
  writeFileSync(join(root, 'test/pins/shardfiles.json'), JSON.stringify({ api: 'local', shards: [{ slug: 'nalati', uploadNumber: 1, hash, bytes: body.length }] }));
  const env = { ...process.env, WILDSHARD_API: base, WILDSHARD_PIN_MIRROR: `${base}/mirror`, WILDSHARD_PIN_CACHE: join(root, 'cache'), WILDSHARD_PIN_RETRY_MS: '1' };
  return { root, env, hash, seen, base };
}
const kept = (root: string, hash: string): string => createHash('sha256').update(readFileSync(join(root, 'kept', `${hash}.tar`))).digest('hex');

test('a pinned shardfile: a mirror 503 is tried again, a mirror 404 falls back to the API, a hard failure names each URL', async () => {
  let tree = await shardTree(hash => ({ [`/mirror/${hash}.tar`]: [503, 200] }));
  expect(await pinsTool(tree.root, tree.env, 'keep', 'kept')).not.toMatch(/neither/u);
  expect(kept(tree.root, tree.hash)).toBe(tree.hash);
  expect(tree.seen.map(request => request.url)).toEqual([`/mirror/${tree.hash}.tar`, `/mirror/${tree.hash}.tar`]);

  tree = await shardTree(hash => ({ [`/mirror/${hash}.tar`]: [404], [`/api/shardfiles/${hash}`]: [503, 200] }));
  expect(await pinsTool(tree.root, tree.env, 'keep', 'kept')).not.toMatch(/neither/u);
  expect(kept(tree.root, tree.hash)).toBe(tree.hash);
  expect(tree.seen.map(request => request.url)).toEqual([`/mirror/${tree.hash}.tar`, `/api/shardfiles/${tree.hash}`, `/api/shardfiles/${tree.hash}`]);

  tree = await shardTree(hash => ({ [`/mirror/${hash}.tar`]: [404], [`/api/shardfiles/${hash}`]: [503, 503, 503] }));
  const stderr = await pinsTool(tree.root, tree.env, 'keep', 'kept');
  expect(stderr).toContain(`neither the mirror nor the API holds ${tree.hash}: could not fetch ${tree.base}/mirror/${tree.hash}.tar (404), then ${tree.base}/api/shardfiles/${tree.hash} (503 after 3 tries)`);
}, 60_000);

test('a pinned shardfile: a mirror that stops sending bytes is cut at the stall limit and the API serves the pin (QA 11-26 row 29)', async () => {
  const body = Buffer.from('a pinned tarball'), hash = createHash('sha256').update(body).digest('hex');
  const seen: string[] = [];
  // The mirror sends its headers and half the body, then nothing: the read a gate copy waited 44 minutes on.
  const server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    seen.push(path);
    if (path === `/mirror/${hash}.tar`) { response.writeHead(200, { 'content-length': String(body.length) }); response.write(body.subarray(0, 8)); return; }
    response.statusCode = path === `/api/shardfiles/${hash}` ? 200 : 404;
    response.end(response.statusCode === 200 ? body : '');
  });
  servers.push(server);
  await new Promise<void>(done => { server.listen(0, '127.0.0.1', () => { done(); }); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No fixture port');
  const base = `http://127.0.0.1:${String(address.port)}`, root = mkdtempSync(join(tmpdir(), 'pins-stall-'));
  folders.push(root);
  mkdirSync(join(root, 'test/pins'), { recursive: true });
  writeFileSync(join(root, 'test/pins/shardfiles.json'), JSON.stringify({ api: 'local', shards: [{ slug: 'nalati', uploadNumber: 1, hash, bytes: body.length }] }));
  const env = { ...process.env, WILDSHARD_API: base, WILDSHARD_PIN_MIRROR: `${base}/mirror`, WILDSHARD_PIN_CACHE: join(root, 'cache'), WILDSHARD_PIN_RETRY_MS: '1', WILDSHARD_PIN_STALL_MS: '300' };
  const began = performance.now(), stderr = await pinsTool(root, env, 'keep', 'kept');
  server.closeAllConnections();
  expect(stderr).toContain('stalled: no bytes for 0.3 s');
  expect(kept(root, hash)).toBe(hash);
  expect(seen).toEqual([`/mirror/${hash}.tar`, `/mirror/${hash}.tar`, `/mirror/${hash}.tar`, `/api/shardfiles/${hash}`]);
  // three stalled reads at 0.3 s and the backoff, never the minutes a stall used to take
  expect(performance.now() - began).toBeLessThan(15_000);
}, 30_000);

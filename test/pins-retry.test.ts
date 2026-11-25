// Meta QA 11-25 row 39 (J505): engine CI's pins install went red on one 503 for a pinned Nalati asset, the second infra
// failure there after 11-24's mirror 404 (run 45404606407). Pins install now tries a 5xx again (3 tries over about
// 30 s), a mirror 404 falls back to the API, and a final failure names every URL it could not fetch.
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
import { fetchPinnedPublicAssets, pinnedPublicAssets } from '../scripts/pin-assets.ts';

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

/** One remote public asset pin, fetched through `request` mapped onto the fake server. */
function assetTree(body: Buffer): { root: string; cache: string } {
  const root = mkdtempSync(join(tmpdir(), 'pins-retry-'));
  folders.push(root);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const row = { slug: 'nalati-grasslands', url: '/assets/gpu/nalati/cards.ktx2', file: `test/pins/assets/${sha256}.ktx2`, sha256, bytes: body.length, remote: true,
    source: { repo: 'shard-nalati', commit: 'c'.repeat(40), path: 'public/assets/gpu/nalati/cards.ktx2', blob: createHash('sha1').update(`blob ${String(body.length)}\0`).update(body).digest('hex') } };
  mkdirSync(join(root, 'test/pins'), { recursive: true });
  writeFileSync(join(root, 'test/pins/assets.json'), JSON.stringify({ version: 1, assets: [row] }));
  return { root, cache: join(root, 'cache') };
}
const RAW = `/project-wildshard/shard-nalati/${'c'.repeat(40)}/public/assets/gpu/nalati/cards.ktx2`;
const CONTENTS = '/repos/project-wildshard/shard-nalati/contents/public/assets/gpu/nalati/cards.ktx2';
const onto = (base: string): typeof fetch => (input, init) => fetch(`${base}${new URL(String(input)).pathname}${new URL(String(input)).search}`, init);

test('a pinned public asset: a 503 is tried again, a 404 falls back to the API, a hard failure names each URL', async () => {
  const body = Buffer.from('nalati card bytes');
  // 503 then 200 from the raw mirror: two raw requests, no API request.
  let tree = assetTree(body), fake = await fakeServer(body, { [RAW]: [503, 200] });
  await fetchPinnedPublicAssets(tree.root, undefined, tree.cache, onto(fake.base), [1, 1]);
  expect(fake.seen.map(request => request.url?.split('?')[0])).toEqual([RAW, RAW]);
  expect(Buffer.from(pinnedPublicAssets(tree.root, undefined, tree.cache)[0]?.body ?? [])).toEqual(body);
  // A raw 404 moves to GitHub's contents API at the pinned commit, asking for the raw bytes, at once.
  tree = assetTree(body); fake = await fakeServer(body, { [RAW]: [404], [CONTENTS]: [200] });
  await fetchPinnedPublicAssets(tree.root, undefined, tree.cache, onto(fake.base), [1, 1]);
  expect(fake.seen.map(request => request.url)).toEqual([RAW, `${CONTENTS}?ref=${'c'.repeat(40)}`]);
  expect(fake.seen[1]?.headers.accept).toBe('application/vnd.github.raw');
  // Three 503s from each source: the error names both URLs and what they answered.
  tree = assetTree(body); fake = await fakeServer(body, { [RAW]: [503, 503, 503], [CONTENTS]: [503, 503, 503] });
  await expect(fetchPinnedPublicAssets(tree.root, undefined, tree.cache, onto(fake.base), [1, 1])).rejects.toThrow(
    `Pinned public asset unavailable: /assets/gpu/nalati/cards.ktx2: could not fetch https://raw.githubusercontent.com${RAW} (503 after 3 tries), then https://api.github.com${CONTENTS}?ref=${'c'.repeat(40)} (503 after 3 tries)`);
  expect(fake.seen).toHaveLength(6);
});

/** pins.ts's stderr once it exits. */
const pinsTool = (cwd: string, env: NodeJS.ProcessEnv, ...args: readonly string[]): Promise<string> => new Promise(done => {
  const child = spawn(process.execPath, [resolve('scripts/pins.ts'), ...args], { cwd, env });
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
  writeFileSync(join(root, 'test/pins/shardfiles.json'), JSON.stringify({ api: 'local', shards: [{ slug: 'nalati', revision: 1, hash, bytes: body.length }] }));
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

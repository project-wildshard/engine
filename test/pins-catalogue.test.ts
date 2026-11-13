// SHARD-DELETE DEL9: nothing engine pins or releases names a slug `GET /api/catalogue` no longer lists (a deleted shard).
// Offline: the pins and the default release pair against `test/pins/catalogue.json`, the catalogue refresh pinned with them.
// The tools: `pins.ts refresh` and `pins-catalogue.ts check` (CI's online half) against a local catalogue with one pinned slug deleted.
/* oxlint-disable import/no-nodejs-modules -- It runs the tool against a local server, as Node. */
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { catalogueSlugs, documentSlugs, pinnedSlugs, releaseNamed, releaseNames, unlistedMessage, unlistedSlugs } from '../scripts/pins-catalogue.ts';

const PINS = 'test/pins/shardfiles.json';
const pins = JSON.parse(readFileSync(PINS, 'utf8')) as { api: string; shards: { slug: string; revision: number; hash: string; bytes: number }[] };
const pinnedCatalogue = JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8')) as unknown;
const servers: Server[] = [], folders: string[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

test('the pins, the default release pair and the pinned document name only slugs the pinned catalogue lists', () => {
  const listed = catalogueSlugs(pinnedCatalogue);
  const unlisted = unlistedSlugs(listed, { [PINS]: pinnedSlugs(pins), default: releaseNames(undefined), document: documentSlugs(pinnedCatalogue) });
  expect(unlistedMessage(unlisted)).toBe('');
});

test('a catalogue missing one pinned slug is red, and green once the pin is dropped', () => {
  const [gone, ...kept] = pins.shards;
  if (gone === undefined) throw new Error('Expected a pinned shard');
  const listed = catalogueSlugs({ shards: kept.map(row => ({ slug: row.slug })) });
  expect(unlistedSlugs(listed, { [PINS]: pinnedSlugs(pins) })).toEqual([{ slug: gone.slug, source: PINS }]);
  expect(unlistedMessage(unlistedSlugs(listed, { [PINS]: pinnedSlugs(pins) }))).toContain(`${gone.slug}, which GET /api/catalogue no longer lists`);
  expect(unlistedSlugs(listed, { [PINS]: pinnedSlugs({ shards: kept }) })).toEqual([]);
});

test('release variables compare by served folder, and an empty variable is the default pair', () => {
  const listed = catalogueSlugs({ shards: [{ slug: 'template' }, { slug: 'driftwood-isle' }, { slug: 'nalati-grasslands' }] });
  expect(unlistedSlugs(listed, { E7_STAGING_SHARDS: releaseNames('_template, driftwood-isle') })).toEqual([]);
  expect(unlistedSlugs(listed, { E7_PRODUCTION_SHARDS: releaseNames('') })).toEqual([]);
  expect(Object.keys(releaseNamed({ E7_STAGING_SHARDS: '', E7_PRODUCTION_SHARDS: 'far-reach' }))).toEqual(['the default release shards (server-release/served-slug.mjs)', 'E7_PRODUCTION_SHARDS']);
  expect(unlistedSlugs(listed, { E7_PRODUCTION_SHARDS: releaseNames('driftwood-isle,far-reach') })).toEqual([{ slug: 'far-reach', source: 'E7_PRODUCTION_SHARDS' }]);
  expect(() => catalogueSlugs({ error: 'down' })).toThrow('expected { shards: [...] }');
});

/** A local API: `catalogue` is `GET /api/catalogue`; the document is the pinned one less `gone`, as the API filters a deleted
 *  slug from it, and the shardfile list is empty. */
async function api(catalogue: unknown, gone = ''): Promise<string> {
  const doc = pinnedCatalogue as { shards: { slug: string }[]; placements: { slug: string }[]; grid: { cells: { slug: string }[] } };
  const kept = (rows: readonly { slug: string }[]): { slug: string }[] => rows.filter(row => row.slug !== gone);
  const document = { ...doc, shards: kept(doc.shards), placements: kept(doc.placements), grid: { ...doc.grid, cells: kept(doc.grid.cells) } };
  const server = createServer((request, response) => {
    const path = request.url ?? '';
    const body = path === '/api/catalogue' ? catalogue : path === '/api/shardfiles' ? [] : path.startsWith('/api/catalogue.json') ? document : undefined;
    response.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' }).end(JSON.stringify(body ?? {}));
  });
  servers.push(server);
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a port');
  return `http://127.0.0.1:${address.port}`;
}

/** The tool's exit code and output, run in a scratch tree holding a copy of the pins. */
const tool = (script: string, cwd: string, env: NodeJS.ProcessEnv, ...args: readonly string[]): Promise<{ code: number | null; out: string }> => new Promise(resolve => {
  const child = spawn(process.execPath, [resolvePath(script), ...args], { cwd, env });
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { out += chunk.toString(); });
  child.on('close', code => { resolve({ code, out }); });
});

function tree(): string {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolvePath('tmp/pins-catalogue-'));
  folders.push(root);
  mkdirSync(join(root, 'test/pins'), { recursive: true });
  writeFileSync(join(root, PINS), JSON.stringify(pins));
  return root;
}

test('pins refresh refuses a pinned slug the catalogue no longer lists, and --drop takes it out', async () => {
  // Deleted: a pin no release names, so only the pin itself names it.
  const gone = pins.shards.find(row => row.slug === 'open-plot-thin-ice') ?? pins.shards.at(-1);
  if (gone === undefined) throw new Error('Expected a pinned shard');
  const live = { shards: pins.shards.filter(row => row !== gone).map(row => ({ slug: row.slug, live: { revision: row.revision, hash: row.hash } })) };
  const root = tree(), env = { PATH: process.env['PATH'], WILDSHARD_API: await api(live, gone.slug) };
  const refused = await tool('scripts/pins.ts', root, env, 'refresh');
  expect(refused.code).not.toBe(0);
  expect(refused.out).toContain(`${PINS} names ${gone.slug}, which GET /api/catalogue no longer lists`);
  expect(JSON.parse(readFileSync(join(root, PINS), 'utf8'))).toEqual(pins);
  const listedDrop = await tool('scripts/pins.ts', root, env, 'refresh', '--drop', 'driftwood-isle');
  expect(listedDrop.code).not.toBe(0);
  expect(listedDrop.out).toContain('--drop driftwood-isle names no pin, or one GET /api/catalogue still lists');
  const dropped = await tool('scripts/pins.ts', root, env, 'refresh', '--drop', gone.slug);
  expect(dropped.code, dropped.out).toBe(0);
  expect(pinnedSlugs(JSON.parse(readFileSync(join(root, PINS), 'utf8')))).toEqual(pins.shards.filter(row => row !== gone).map(row => row.slug));
}, 30_000);

test('the catalogue check is red for a deleted pin or release slug, green otherwise, and a down API only warns', async () => {
  const all = { shards: pins.shards.map(row => ({ slug: row.slug })) };
  const root = tree(), base = { PATH: process.env['PATH'] };
  const green = await tool('scripts/pins-catalogue.ts', root, { ...base, WILDSHARD_API: await api(all), E7_STAGING_SHARDS: '_template,driftwood-isle', E7_PRODUCTION_SHARDS: '' }, 'check');
  expect(green.code, green.out).toBe(0);
  const noFar = { shards: all.shards.filter(row => row.slug !== 'far-reach') };
  const red = await tool('scripts/pins-catalogue.ts', root, { ...base, WILDSHARD_API: await api(noFar), E7_PRODUCTION_SHARDS: 'far-reach' }, 'check');
  expect(red.code).not.toBe(0);
  expect(red.out).toContain(`${PINS} names far-reach`);
  expect(red.out).toContain('E7_PRODUCTION_SHARDS names far-reach');
  expect(red.out).toContain('A shard was deleted on the API, not by this commit');
  const html = await tool('scripts/pins-catalogue.ts', root, { ...base, WILDSHARD_API: await api('<html>error page</html>') }, 'check');
  expect(html.code, html.out).toBe(0);
  expect(html.out).toContain('::warning title=catalogue check skipped::');
  const down = await tool('scripts/pins-catalogue.ts', root, { ...base, WILDSHARD_API: 'http://127.0.0.1:9' }, 'check');
  expect(down.code, down.out).toBe(0);
  expect(down.out).toContain('::warning title=catalogue check skipped::');
}, 30_000);

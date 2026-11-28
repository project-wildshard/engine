// @vitest-environment node
// Fix preview PV2 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md): preview's zone table from staging's signed
// release, the cook-version skew check, and the go-live check that HEADs every cooked object the table names.
// oxlint-disable-next-line import/no-nodejs-modules -- An in-memory Ed25519 key signs the fixture release and placement files.
import {generateKeyPairSync, sign} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The bake writes a real index.html in owned scratch under tmp/.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine the scratch root to this checkout.
import {join, resolve} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {borrowZoneTable, buildZoneTable, checkCooked, cookSkew, ownZoneTable, unservedPlacements, zoneTableOf, STAGING_PLACEMENTS, STAGING_RELEASE} from '../src/scripts/page-release/zone-table.mjs';
import {bakeZoneTable, zoneTableIn} from '../src/scripts/app-build/zoneTable.mjs';
import {readZoneTable} from '../src/shared/game/grid/zoneTable.ts';
import {COOKED_ORIGIN} from '../src/shared/game/shardfile/cookedPackPaths.ts';
import type {ReleaseFile} from '../src/shared/host/releaseRows.ts';
import type {PlacementFile} from '../src/shared/game/grid/placementRows.ts';

const build = 'a'.repeat(40), cookHash = 'c'.repeat(64);
const release = (over: Partial<ReleaseFile> = {}): ReleaseFile => ({channel: 'staging', serial: 159, engineBuild: build, saveEpoch: 2,
  shards: [{slug: 'driftwood-isle', revision: 13, shardVersion: '0.3.1'}, {slug: 'pine-hollow', revision: 18, shardVersion: '1.2.0'}],
  cook: {version: '1.0.0', hash: cookHash}, bundle: {name: 'x/y.tar.gz', sha256: 'd'.repeat(64)}, socket: 'wss://rooms-staging.wildshard.io', ...over});
const placements = (cells: PlacementFile['cells']): PlacementFile => ({kind: 'placement', channel: 'staging', serial: 107, cells});

test('the table names each zone of the release and its placements once, at its shard version under staging\'s cook', () => {
  const table = zoneTableOf(release(), placements([
    {instance: 'blender-template', slug: 'brasscap-mesa', cell: [-1, -1], hash: 'e'.repeat(64), shardVersion: '0.0.19'},
    {instance: 'driftwood', slug: '_driftwood-isle', cell: [0, 0]},
  ]));
  expect(table.from).toEqual({channel: 'staging', serial: 159, engineBuild: build});
  expect(table.zones).toEqual([
    {slug: 'driftwood-isle', shardVersion: '0.3.1', index: `shards/driftwood-isle/0.3.1/cooks/1.0.0/${cookHash}/index.json`},
    {slug: 'pine-hollow', shardVersion: '1.2.0', index: `shards/pine-hollow/1.2.0/cooks/1.0.0/${cookHash}/index.json`},
    {slug: 'brasscap-mesa', shardVersion: '0.0.19', index: `shards/brasscap-mesa/0.0.19/cooks/1.0.0/${cookHash}/index.json`},
  ]);
  expect(readZoneTable(JSON.parse(JSON.stringify(table)))).toEqual(table);
  expect(() => readZoneTable({...table, zones: [{...table.zones[0], index: 'index/x/y.json'}]})).toThrow(/not its cook key/u);
  // PV4: a table may name its bucket: https anywhere, http on the loopback only (the headless proof's local bucket)
  for (const origin of ['https://cooked.wildshard.io/', 'http://127.0.0.1:4522/']) expect(readZoneTable({...table, origin}).origin).toBe(origin);
  for (const origin of ['http://cooked.example/', 'https://cooked.wildshard.io', 'javascript:alert(1)//']) expect(() => readZoneTable({...table, origin})).toThrow();
});

test('QA 82 follow-up: a cell only the page\'s catalogue places joins the table, and a check names any it still lacks', () => {
  // preview v78ae9605c: the pins place a hidden solo plot staging's release and placement file don't name; its discovery
  // answered 404 and every preview boot failed at app:selected-discovery
  const catalogue = {shards: [{slug: 'open-plot-desert-ruin', shardVersion: '0.0.4'}, {slug: 'pine-hollow', shardVersion: '1.2.0'}],
    placements: [{slug: 'open-plot-desert-ruin'}, {slug: 'pine-hollow'}]};
  const borrowed = zoneTableOf(release(), null);
  expect(unservedPlacements(borrowed, catalogue)).toEqual(['open-plot-desert-ruin']);
  const table = zoneTableOf(release(), null, catalogue);
  expect(table.zones.map(row => `${row.slug} ${row.shardVersion}`)).toEqual(['driftwood-isle 0.3.1', 'pine-hollow 1.2.0', 'open-plot-desert-ruin 0.0.4']);
  expect(unservedPlacements(table, catalogue)).toEqual([]);
  // a placed cell the catalogue gives no version is refused by name, never baked unserved
  expect(() => zoneTableOf(release(), null, {shards: [], placements: [{slug: 'open-plot-thin-ice'}]})).toThrow(/open-plot-thin-ice/u);
});

test('a release with no cook, or a zone with no shard version, is refused by name', () => {
  const {cook: _cook, ...old} = release();
  expect(() => zoneTableOf(old, null)).toThrow(/names no cook version/u);
  expect(() => zoneTableOf(release({shards: [{slug: 'far-reach', revision: 9}]}), null)).toThrow(/no shard version for 1 zone\(s\): far-reach/u);
  expect(() => zoneTableOf(release(), placements([{instance: 'mossgate', slug: 'mossgate', cell: [1, 1]}]))).toThrow(/mossgate/u);
});

test('the skew check refuses another cook version, naming both, and passes another cook hash under the same version', () => {
  const table = zoneTableOf(release(), null);
  expect(cookSkew('1.0.0', table)).toBeUndefined();
  expect(cookSkew('1.1.0', table)).toMatch(/main cooks 1\.1\.0, staging's release \(serial 159, build aaaaaaaaaa\) cooked 1\.0\.0/u);
  expect(cookSkew('1.0.0', zoneTableOf(release({cook: {version: '1.0.0', hash: 'f'.repeat(64)}}), null))).toBeUndefined();
});

const {publicKey, privateKey} = generateKeyPairSync('ed25519');
const key = publicKey.export({format: 'der', type: 'spki'}).toString('hex');
const signedText = (body: unknown): string => { const text = JSON.stringify(body); return JSON.stringify({body: text, signature: sign(null, Buffer.from(text), privateKey).toString('hex')}); };

test('borrowing reads staging\'s signed files from releases.wildshard.io and refuses a skew or a forged file', async () => {
  const served = new Map<string, string>([[STAGING_RELEASE, signedText(release())], [STAGING_PLACEMENTS, signedText(placements([]))]]);
  const read = (url: string): Promise<Response> => {
    const text = served.get(url.split('?')[0] ?? '');
    return Promise.resolve(text === undefined ? new Response('', {status: 404}) : new Response(text));
  };
  const table = await borrowZoneTable({cookVersion: '1.0.0', read, releaseKey: key, placementKey: key});
  expect(table.zones.map(row => row.slug)).toEqual(['driftwood-isle', 'pine-hollow']);
  await expect(borrowZoneTable({cookVersion: '2.0.0', read, releaseKey: key, placementKey: key})).rejects.toThrow(/cook version skew: main cooks 2\.0\.0/u);
  served.delete(STAGING_PLACEMENTS);
  expect((await borrowZoneTable({cookVersion: '1.0.0', read, releaseKey: key, placementKey: key})).zones).toHaveLength(2);
  const other = generateKeyPairSync('ed25519').publicKey.export({format: 'der', type: 'spki'}).toString('hex');
  await expect(borrowZoneTable({cookVersion: '1.0.0', read, releaseKey: other, placementKey: key})).rejects.toThrow(/signature/u);
});

test('PV18: a skew refusal writes one receipt line naming both cook versions and the cook files that differ', async () => {
  mkdirSync(resolve('tmp'), {recursive: true});
  const dir = mkdtempSync(join(resolve('tmp'), 'zone-skew-')); scratch.push(dir);
  const receipts = join(dir, 'receipts.log'), served = new Map([[STAGING_RELEASE, signedText(release())], [STAGING_PLACEMENTS, signedText(placements([]))]]);
  const read = (url: string): Promise<Response> => Promise.resolve(new Response(served.get(url.split('?')[0] ?? '') ?? '', {status: served.has(url.split('?')[0] ?? '') ? 200 : 404}));
  const asked: string[] = [];
  const files = (at: string): string[] => { asked.push(at); return ['src/cook/game/shardCook.ts', 'src/cook/game/cook-version.json']; };
  await expect(buildZoneTable({cookVersion: '1.1.0', read, releaseKey: key, placementKey: key, receipts, files})).rejects.toThrow(/cook version skew/u);
  const [line, ...rest] = readFileSync(receipts, 'utf8').trimEnd().split('\n');
  expect(rest).toEqual([]);
  expect(asked).toEqual([build]);
  expect(line).toMatch(/^\d\d:\d\d UTC \S+ BLOCKED preview: cook version skew, main cooks 1\.1\.0 and staging \(serial 159, build aaaaaaaaaa\) cooked 1\.0\.0; .*cook files that differ \(2\): src\/cook\/game\/shardCook\.ts, src\/cook\/game\/cook-version\.json$/u);
  expect((await buildZoneTable({cookVersion: '1.0.0', read, releaseKey: key, placementKey: key, receipts, files})).zones).toHaveLength(2);
  expect(readFileSync(receipts, 'utf8').trimEnd().split('\n')).toHaveLength(1);
});

test('the go-live check passes when every index and object answers 200, and names each miss', async () => {
  const table = zoneTableOf(release(), null);
  const [drift, pine] = table.zones;
  const prefix = (slug: string, version: string) => `shards/${slug}/${version}/`;
  const objects = new Map<string, unknown>([
    [drift?.index ?? '', {objects: {'assets/spawn/parts/1.pack.br': `${prefix('driftwood-isle', '0.3.1')}common/aa`, 'assets/spawn/x.json': `${prefix('driftwood-isle', '0.3.1')}cooks/1.0.0/bb`}}],
    [pine?.index ?? '', {objects: {'assets/spawn/parts/2.pack.br': `${prefix('pine-hollow', '1.2.0')}common/cc`}}],
    [`${prefix('driftwood-isle', '0.3.1')}common/aa`, ''], [`${prefix('driftwood-isle', '0.3.1')}cooks/1.0.0/bb`, ''], [`${prefix('pine-hollow', '1.2.0')}common/cc`, ''],
  ]);
  const seen: string[] = [];
  const read = (url: string, init?: RequestInit): Promise<Response> => {
    seen.push(`${init?.method ?? 'GET'} ${url} ${new Headers(init?.headers).get('origin') ?? ''}`);
    const at = url.slice(COOKED_ORIGIN.length);
    if (!objects.has(at)) return Promise.resolve(new Response('', {status: 404}));
    const body = objects.get(at);
    return Promise.resolve(typeof body === 'string' ? new Response(body) : Response.json(body));
  };
  expect(await checkCooked(table, {read, page: 'https://preview.wildshard.io'})).toEqual({zones: 2, objects: 3, missing: []});
  expect(seen).toContain(`HEAD ${COOKED_ORIGIN}${prefix('pine-hollow', '1.2.0')}common/cc https://preview.wildshard.io`);
  objects.delete(`${prefix('pine-hollow', '1.2.0')}common/cc`);
  expect((await checkCooked(table, {read})).missing).toEqual([`pine-hollow ${prefix('pine-hollow', '1.2.0')}common/cc 404`]);
  objects.delete(drift?.index ?? '');
  expect((await checkCooked(table, {read})).missing).toEqual([`driftwood-isle ${drift?.index ?? ''} 404`, `pine-hollow ${prefix('pine-hollow', '1.2.0')}common/cc 404`]);
  objects.set(pine?.index ?? '', {objects: {'a.json': `${prefix('driftwood-isle', '0.3.1')}common/aa`}});
  expect((await checkCooked(table, {read})).missing.some(line => line.includes('outside shards/pine-hollow/1.2.0/'))).toBe(true);
});

const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, {recursive: true, force: true}); });

test('a build given a zone table bakes it as a file and inline in index.html; one given none bakes nothing', () => {
  mkdirSync(resolve('tmp'), {recursive: true});
  const out = mkdtempSync(join(resolve('tmp'), 'zone-table-')); scratch.push(out);
  writeFileSync(join(out, 'index.html'), '<html><head></head><body></body></html>');
  writeFileSync(join(out, 'version.json'), JSON.stringify({build: 'b1-x', clientVersion: '0.1.97'}));
  bakeZoneTable(out, undefined);
  expect(zoneTableIn(readFileSync(join(out, 'index.html'), 'utf8'))).toBeUndefined();
  const table = zoneTableOf(release(), null), file = join(out, 'in.json');
  writeFileSync(file, JSON.stringify(table));
  bakeZoneTable(out, file);
  bakeZoneTable(out, file);
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  expect(zoneTableIn(html)).toEqual(table);
  expect(html.match(/id="ws-zone-table"/gu)).toHaveLength(1);
  expect(JSON.parse(readFileSync(join(out, 'zone-table.json'), 'utf8'))).toEqual(table);
  // PV14 (codex-cookkeys): beside the build's code too, so its chunk graph carries it
  expect(JSON.parse(readFileSync(join(out, 'builds/0.1.97/b1-x/zone-table.json'), 'utf8'))).toEqual(table);
});

// Fix preview PV16: staging and production take their own table from the pins they bake and main's cook.
test('a staging build\'s own table names each pinned and placed zone at its shard version under main\'s cook; an old pin set has none', () => {
  const cook = {version: '1.0.0', hash: 'c'.repeat(64)}, build = 'b'.repeat(40);
  const catalogue = {shards: [{slug: 'driftwood-isle', shardVersion: '0.3.1'}, {slug: '_pine-hollow', shardVersion: '1.0.0'}], placements: [{slug: 'driftwood-isle'}]};
  const {table} = ownZoneTable({channel: 'staging', build, serial: 8, catalogue, cook});
  expect(table?.from).toEqual({channel: 'staging', serial: 8, engineBuild: build});
  expect(table?.zones.map(row => [row.slug, row.shardVersion, row.index])).toEqual([
    ['driftwood-isle', '0.3.1', `shards/driftwood-isle/0.3.1/cooks/1.0.0/${cook.hash}/index.json`],
    ['pine-hollow', '1.0.0', `shards/pine-hollow/1.0.0/cooks/1.0.0/${cook.hash}/index.json`]]);
  expect(ownZoneTable({channel: 'production', build, serial: 1, catalogue: {shards: [{slug: 'driftwood-isle'}], placements: [{slug: 'far-reach'}]}, cook}))
    .toEqual({missing: ['driftwood-isle', 'far-reach']});
});

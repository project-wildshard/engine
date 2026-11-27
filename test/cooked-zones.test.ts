// @vitest-environment happy-dom
// Fix preview PV4, PV5 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md): a page with a zone table loads every zone
// from the cook, through its index at the table's key, checked against the table's cook (not this page's build); its objects table
// resolves page paths (parts, manifests, loose files, programs) to where the cook stored them.
import { afterEach, expect, test } from 'vitest';
import { bakedZoneTable, COOKED_ZONE_MISSING, cookedZone, learnCookedZones } from '../src/client/game/grid/cookedZones';
import { clearCookedObjects, contentURL, cookedObjectURL, loadPortrait, pageURL } from '@wildshard/engine/boot/contentBase';
import { clearPlacedSpawns, placedSpawn } from '../src/client/game/boot/placedSpawn';
import { entryProgramsURL } from '../src/client/game/boot/spawnDownload';
import { readZoneTable, type ZoneTable } from '../src/shared/game/grid/zoneTable';
import { cookedIndexKey } from '../src/shared/game/shardfile/cookedPackPaths';

const ORIGIN = 'https://cooked.example/', SLUG = 'driftwood-isle', VERSION = '0.3.1', COOK = '1.0.0', HASH = 'c'.repeat(64);
const ref = { slug: SLUG, shardVersion: VERSION, cookVersion: COOK, cookHash: HASH };
const table: ZoneTable = readZoneTable({ version: 1, from: { channel: 'staging', serial: 159, engineBuild: 'a'.repeat(40) }, cookVersion: COOK, cookHash: HASH,
  zones: [{ slug: SLUG, shardVersion: VERSION, index: cookedIndexKey(ref) }, { slug: 'pine-hollow', shardVersion: '1.2.0', index: cookedIndexKey({ ...ref, slug: 'pine-hollow', shardVersion: '1.2.0' }) }] });
const common = (name: string): string => `shards/${SLUG}/${VERSION}/common/${name}`, cooks = (name: string): string => `shards/${SLUG}/${VERSION}/cooks/${COOK}/${name}`;

const HEADER = `/shardfiles/${SLUG}/shard.json`;
const manifest = (tier: 'phone' | 'desktop'): string => JSON.stringify({ version: 1, shard: SLUG, tier, flow: 'client', totalBytes: 12, files: [{ url: HEADER, bytes: 12, hash: 'd'.repeat(64) }] });
const ROWS = (['phone', 'desktop'] as const).map((tier, n) => ({ url: `/assets/spawn/${SLUG}-entry-${tier}-${String(n + 1).repeat(16)}.json`, tier, set: 'entry' as const, files: 1, totalBytes: 12, wireBytes: 0 }));
const IMAGE = (n: string): string => `shardfiles/${SLUG}/blobs/image/${n.repeat(64)}.jpg`;
const OBJECTS: Record<string, string> = {
  [ROWS[0]?.url.slice(1) ?? '']: cooks('m1.json'), [ROWS[1]?.url.slice(1) ?? '']: cooks('m2.json'),
  'assets/spawn/parts/0123456789abcdef.pack.br': common('p1'), [HEADER.slice(1)]: common('h'), [`programs/${SLUG}.json`]: common('programs'),
  [`shardfiles/${SLUG}/discovery.json`]: common('discovery'), [IMAGE('1')]: common('i1'), [IMAGE('2')]: common('i2'), [IMAGE('3')]: common('i3'),
};
const INDEX = { version: 2, ...ref, hash: 'e'.repeat(64), header: HEADER.slice(1), manifests: ROWS, objects: OBJECTS };
const served = (): Map<string, unknown> => new Map<string, unknown>([
  [cookedIndexKey(ref), INDEX], [cooks('m1.json'), manifest('phone')], [cooks('m2.json'), manifest('desktop')],
  [common('discovery'), { data: { card: { thumb: `/${IMAGE('1')}`, portrait: `/${IMAGE('2')}`, landscape: `/${IMAGE('3')}` } } }],
]);
function store(objects = served()): typeof fetch & { asked: string[] } {
  const asked: string[] = [];
  const read = function (this: unknown, input: string | URL | Request): Promise<Response> {
    // the browser's fetch throws "Illegal invocation" when called on another receiver (`ports.fetch(…)`); so does this one
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    const url = String(input instanceof Request ? input.url : input);
    asked.push(url);
    const body = url.startsWith(ORIGIN) ? objects.get(url.slice(ORIGIN.length)) : undefined;
    return Promise.resolve(body === undefined ? new Response('', { status: 404 }) : new Response(typeof body === 'string' ? body : JSON.stringify(body)));
  };
  return Object.assign(read as typeof fetch, { asked });
}
const ports = (read: typeof fetch) => ({ fetch: read, signal: new AbortController().signal, origin: ORIGIN, validator: null });

afterEach(() => { clearCookedObjects(); clearPlacedSpawns(); document.body.innerHTML = ''; });

test('a zone is read through the table\'s index key and its objects, never the page origin or its build', async () => {
  const read = store();
  const zone = await cookedZone(table, table.zones[0] ?? table.zones[1] ?? (() => { throw new Error('no zone'); })(), ports(read));
  expect(zone).toBeDefined();
  expect(read.asked[0]).toBe(`${ORIGIN}shards/${SLUG}/${VERSION}/cooks/${COOK}/${HASH}/index.json`);
  expect(read.asked.every(url => url.startsWith(ORIGIN))).toBe(true);
  expect(zone?.content.spawn.entry.phone?.url).toBe(ROWS[0]?.url);
  expect(zone?.content.spawn.programs).toBe(true);
  expect(zone?.content.card).toEqual({ thumb: `${ORIGIN}${common('i1')}`, portrait: `${ORIGIN}${common('i2')}`, landscape: `${ORIGIN}${common('i3')}` });
  expect(zone?.objects.get('/assets/spawn/parts/0123456789abcdef.pack.br')).toBe(`${ORIGIN}${common('p1')}`);
});

test('another cook\'s index, a 404 or an object outside the shard version gives nothing', async () => {
  const row = table.zones[0];
  if (row === undefined) throw new Error('no zone');
  const other = served(); other.set(cookedIndexKey(ref), { ...INDEX, cookHash: 'f'.repeat(64) });
  expect(await cookedZone(table, row, ports(store(other)))).toBeUndefined();
  const gone = served(); gone.delete(cookedIndexKey(ref));
  expect(await cookedZone(table, row, ports(store(gone)))).toBeUndefined();
  const stray = served(); stray.set(cookedIndexKey(ref), { ...INDEX, objects: { ...OBJECTS, 'x.json': 'shards/pine-hollow/1.2.0/common/x' } });
  expect(await cookedZone(table, row, ports(store(stray)))).toBeUndefined();
  const lost = served(); lost.delete(cooks('m1.json'));
  expect(await cookedZone(table, row, ports(store(lost)))).toBeUndefined();
});

test('learning the table installs each found zone and names the missing ones for the updated card', async () => {
  const seen: unknown[] = [];
  addEventListener(COOKED_ZONE_MISSING, event => { seen.push((event as CustomEvent).detail); });
  const answer = await learnCookedZones(table, ports(store()));
  expect(answer).toEqual({ installed: [SLUG], missing: ['pine-hollow'] });
  expect(seen).toEqual([{ slugs: ['pine-hollow'], cook: `${COOK}/${HASH.slice(0, 12)}` }]);
  expect(placedSpawn(`_${SLUG}`)?.entry.desktop?.url).toBe(ROWS[1]?.url);
  // the content resolver: page paths read where the cook stored them, and back
  const part = new URL('/assets/spawn/parts/0123456789abcdef.pack.br', document.baseURI).href;
  expect(contentURL(part)).toBe(`${ORIGIN}${common('p1')}`);
  expect(pageURL(`${ORIGIN}${common('p1')}?v=1`)).toBe(`${part}?v=1`);
  expect(cookedObjectURL('/assets/boot-tables-x.json')).toBeUndefined();
  expect(contentURL(new URL('/assets/boot-tables-x.json', document.baseURI).href)).toBe(new URL('/assets/boot-tables-x.json', document.baseURI).href);
  // PV5: the zone's warm-up programs come from its index, not `loose/<hash>/programs/`
  expect(entryProgramsURL(SLUG)).toBe(`${ORIGIN}${common('programs')}`);
});

test('the table\'s own bucket origin is where its zones are read, and a manifest row\'s code list comes along', async () => {
  const other = 'http://127.0.0.1:4522/', code = { url: '/assets/spawn/code/bbe313ded99e664c.json', bytes: 4130 };
  const objects = new Map([...served()].map(([key, body]) => [key, key === cookedIndexKey(ref) ? { ...INDEX, manifests: ROWS.map(row => ({ ...row, code })) } : body]));
  const asked: string[] = [];
  const read = ((input: string | URL | Request): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input); asked.push(url);
    const body = url.startsWith(other) ? objects.get(url.slice(other.length)) : undefined;
    return Promise.resolve(body === undefined ? new Response('', { status: 404 }) : new Response(typeof body === 'string' ? body : JSON.stringify(body)));
  }) as typeof fetch;
  const row = table.zones[0];
  if (row === undefined) throw new Error('no zone');
  const zone = await cookedZone({ ...table, origin: other }, row, { fetch: read, signal: new AbortController().signal, validator: null });
  expect(asked.every(url => url.startsWith(other))).toBe(true);
  expect(zone?.content.spawn.entry.phone?.code).toEqual(code);
});

test('the loading card holds a zone\'s art until the cook says where it is, then paints it from there', async () => {
  const art = `/${IMAGE('2')}`, root = document.documentElement;
  document.head.innerHTML = `<script type="application/json" id="ws-zone-table">${JSON.stringify(table)}</script>`;
  root.style.removeProperty('--ws-load-portrait');
  loadPortrait(art);
  // the page origin holds no zone file: nothing is painted (no read) until the zone's index is in
  expect(root.style.getPropertyValue('--ws-load-portrait')).toBe('');
  expect(root.dataset['wsLoadArt']).toBe(art);
  await learnCookedZones(table, ports(store()));
  expect(root.style.getPropertyValue('--ws-load-portrait')).toBe(`url("${ORIGIN}${common('i2')}")`);
  expect(root.dataset['wsLoadArt']).toBeUndefined();
  loadPortrait('/assets/title/x.jpg');
  expect(root.style.getPropertyValue('--ws-load-portrait')).toBe('url("/assets/title/x.jpg")');
  document.head.innerHTML = '';
});

test('a page carries its table inline, or none', () => {
  expect(bakedZoneTable()).toBeUndefined();
  document.body.innerHTML = `<script type="application/json" id="ws-zone-table">${JSON.stringify(table)}</script>`;
  expect(bakedZoneTable()).toEqual(table);
});

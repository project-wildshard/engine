// @vitest-environment node
// SHARD-AUTHORING SA33 to SA35, the page half: a released page learns the cells the API placed after its build from its channel's signed
// placement file (SA33a), checked under the API's placement key as the box (`readPlacementFile`) and SA35's preview bake check it. A
// verified cell gets a Shard Select card and `?chunk=` enters the grid there, ring 3 included; a bad signature, a 404, a slow or an
// unreadable file keep the build's 25 cells.
// oxlint-disable-next-line import/no-nodejs-modules -- It signs as the API does.
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installCatalogue, installedCatalogue } from '../src/shared/game/grid/catalogueSlot';
import { PLACEMENT_PUBLIC_KEY, placementsURL } from '../src/shared/game/grid/placementRows';
import { readPlacementFile } from '../src/server/host/dedicated/placementFile';
import { PLACEMENT_PUBLIC_KEY as PREVIEW_GRID_KEY } from '../scripts/preview-grid';
import { addPlacedCells, learnPlacedCells, placementsOf, readSignedPlacement, type PlacedKeep } from '../src/client/game/grid/placedCells';
import { installTitleManifests, titleManifests, type TitleManifest } from '../src/client/game/shard/titleList';
import { titleCards } from '../src/client/game/titleDeck';
import { oneWayIn, shardCell } from '../src/client/game/grid/oneWayIn';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import type { PlacedContent } from '../src/client/game/grid/placedContent';

const URL_AT = 'https://packs.example/releases/staging-placements.json';
const pair = (): { readonly privateKey: KeyObject; readonly hex: string } => {
  const key = generateKeyPairSync('ed25519');
  return { privateKey: key.privateKey, hex: key.publicKey.export({ type: 'spki', format: 'der' }).toString('hex') };
};
const api = pair();
type Cells = readonly { readonly instance: string; readonly slug: string; readonly cell: readonly [number, number] }[];
const THIN_ICE: Cells = [{ instance: 'open-plot-thin-ice', slug: 'open-plot-thin-ice', cell: [0, 3] }];
const signed = (cells: Cells = THIN_ICE, serial = 1, channel = 'staging', key: KeyObject = api.privateKey): string => {
  const body = JSON.stringify({ kind: 'placement', channel, serial, cells });
  return JSON.stringify({ body, signature: sign(null, Buffer.from(body), key).toString('hex') });
};
const answering = (text: string, status = 200): typeof fetch => () => Promise.resolve(new Response(text, { status }));
// SA46: a new author's slug, uploaded and placed after the build: no title row, its card from the API's catalogue entry
const API = 'https://api.example';
const FRESH: Cells = [{ instance: 'new-author-shard', slug: 'new-author-shard', cell: [1, 3] }];
const ENTRY_AT = `${API}/api/catalogue/shards/new-author-shard`;
const ENTRY = { slug: 'new-author-shard', name: 'Glass Orchard', heroHash: null, live: { revision: 1, hash: 'ab' } };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** A fetch that serves the placement file (`FRESH` by default) and these routes, and records what it was asked. */
const routes = (table: Record<string, (init?: RequestInit) => Response | Promise<Response>>, file = signed(FRESH)): typeof fetch & { readonly asked: string[] } => {
  const asked: string[] = [];
  // a browser's `fetch` throws Illegal invocation when called as another object's method: the port must be called bare
  const answer = function (this: unknown, url: string | URL | Request, init?: RequestInit): Promise<Response> {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    const at = url instanceof Request ? url.url : String(url);
    asked.push(at);
    if (at === URL_AT) return Promise.resolve(new Response(file, { status: 200 }));
    const route = table[at];
    return route === undefined ? Promise.resolve(new Response('', { status: 404 })) : Promise.resolve(route(init));
  };
  return Object.assign(answer, { asked }) as typeof fetch & { readonly asked: string[] };
};
/** SA48: a carded slug enters only with the cook's content; these SA46 tests are about its card, so its content is a stand-in. */
const STAND_IN: PlacedContent = { spawn: { slug: 'new-author-shard', entry: {}, whole: {}, base: 'https://packs.example/', loose: 'https://packs.example/loose/x/', programs: false }, verdict: null };
const cooked = (): Promise<PlacedContent> => Promise.resolve(STAND_IN);
const PIN = JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8')) as { grid: { cells: Cells } };
const ART = { thumb: '/t.jpg', portrait: '/p.jpg', landscape: '/l.jpg' };
// the live title rows' Thin Ice: an open plot, `shardSelect: false`, its art in the build
const ROWS: readonly TitleManifest[] = [
  { slug: 'driftwood-isle', name: 'Driftwood Isle', biome: '', status: 'live', card: ART },
  { slug: 'open-plot-thin-ice', name: 'Open Plot · Thin Ice', biome: 'Open plot · coming soon', status: 'earlyAccess', card: ART, shardSelect: false },
];
const cards = (): readonly string[] => titleCards(false, () => null, () => null, () => true).map(card => card.slug);
const gridSlugs = (): readonly string[] => (installedCatalogue()?.grid.cells ?? []).map(cell => cell.slug);
const player = { developer: false, devserver: false };

/** OF20: each test's own device keep, so no test reads another's kept file */
let device: PlacedKeep & { readonly kept: Map<string, string> };
const memoryKeep = (): typeof device => { const kept = new Map<string, string>(); return { kept, read: url => kept.get(url) ?? null, write: (url, text) => { if (text === null) kept.delete(url); else kept.set(url, text); } }; };
beforeEach(() => { installCatalogue(PIN); installTitleManifests(ROWS); device = memoryKeep(); });
afterEach(() => { Reflect.deleteProperty(globalThis, Symbol.for('game.catalogue')); });

test('one key: the page, the box and the preview bake believe the same placement key, and the page reads what the box reads', async () => {
  expect(PLACEMENT_PUBLIC_KEY).toBe(PREVIEW_GRID_KEY);
  const text = signed();
  expect(await readSignedPlacement(text, api.hex)).toEqual(readPlacementFile(text, api.hex));
  await expect(readSignedPlacement(text, PLACEMENT_PUBLIC_KEY), 'a throwaway key is not the API').rejects.toThrow(/bad signature/u);
});

test('the address: a released page reads its own channel\'s file; preview and a solo build read none', () => {
  expect(placementsURL('https://packs.wildshard.io/releases/staging.json')).toBe('https://packs.wildshard.io/releases/staging-placements.json');
  expect(placementsURL('https://packs.wildshard.io/releases/production.json')).toBe('https://packs.wildshard.io/releases/production-placements.json');
  expect(placementsURL('https://packs.wildshard.io/releases/preview.json')).toBeNull();
  expect(placementsURL('not a url')).toBeNull();
  expect(placementsOf({ __WS_WORLD__: { release: 'https://packs.wildshard.io/releases/staging.json', key: 'ab' } })).toBe('https://packs.wildshard.io/releases/staging-placements.json');
  expect(placementsOf({})).toBeNull();
  expect(placementsOf({ __WS_PLACEMENTS__: URL_AT })).toBe(URL_AT);
});

test('a verified file adds the cell: Thin Ice gets its card, `?chunk=` enters the grid at ring 3\'s (0,3)', async () => {
  expect(cards()).toEqual(['driftwood-isle']);
  expect(shardCell('open-plot-thin-ice')).toBeUndefined();
  const read = await learnPlacedCells(URL_AT, { keep: device, fetch: answering(signed()), publicKey: api.hex });
  expect(read).toEqual({ added: THIN_ICE, left: [], serial: 1, carded: [] });
  expect(gridSlugs()).toHaveLength(26);
  expect(installedCatalogue()?.placed).toEqual(['open-plot-thin-ice']);
  expect(cards(), 'the card, with the build\'s name and art').toEqual(['driftwood-isle', 'open-plot-thin-ice']);
  expect(titleCards(false, () => null, () => null, () => true)[1]).toMatchObject({ name: 'Open Plot · Thin Ice', thumbnail: '/t.jpg', badge: 'Early access' });
  // the one way in: a world page enters the grid at the placed cell, which the drawn 7 × 7 admits
  const cell = oneWayIn({ online: true, hosted: true, slug: 'open-plot-thin-ice', kept: false }, new GridAssembly(player));
  expect(cell).toMatchObject({ instance: 'open-plot-thin-ice', cell: [0, 3] });
  expect(new GridAssembly(player).cell('open-plot-thin-ice').origin.z).toBe(3 * new GridAssembly(player).pitch);
});

test('a bad signature, another channel, a 404, a 500, a hung read and nonsense all keep the build\'s 25 cells', async () => {
  const other = pair(), tampered = signed().replace('[0,3]', '[0,2]');
  const hung: typeof fetch = (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { reject(new DOMException('timed out', 'TimeoutError')); }); });
  for (const [why, ports] of [
    ['another key', { fetch: answering(signed(THIN_ICE, 1, 'staging', other.privateKey)), publicKey: api.hex }],
    ['a changed body', { fetch: answering(tampered), publicKey: api.hex }],
    ['the production file at the staging address', { fetch: answering(signed(THIN_ICE, 1, 'production')), publicKey: api.hex }],
    ['404', { fetch: answering('', 404), publicKey: api.hex }],
    ['500', { fetch: answering('oops', 500), publicKey: api.hex }],
    ['offline', { fetch: () => Promise.reject(new TypeError('Failed to fetch')), publicKey: api.hex }],
    ['hung', { fetch: hung, publicKey: api.hex, deadlineMs: 20 }],
    ['not json', { fetch: answering('<html>'), publicKey: api.hex }],
  ] as const) {
    const read = await learnPlacedCells(URL_AT, ports);
    expect(read, why).toHaveProperty('kept');
    expect(gridSlugs(), why).toEqual(PIN.grid.cells.map(cell => cell.slug));
    expect(cards(), why).toEqual(['driftwood-isle']);
  }
  expect(await learnPlacedCells(URL_AT, { keep: device, fetch: answering('', 404), publicKey: api.hex })).toEqual({ kept: 'no placement file (404): nothing placed on this channel' });
});

test('cells the box would refuse are left out, and the build\'s own cell is kept once', () => {
  const document = installedCatalogue();
  if (document === undefined) throw new Error('no catalogue');
  const placed = addPlacedCells(document, { kind: 'placement', channel: 'staging', serial: 3, cells: [
    { instance: 'driftwood-isle', slug: 'driftwood-isle', cell: [0, 0] }, // the build's own: kept once
    { instance: 'far', slug: 'far', cell: [4, 0] }, // off the 7 × 7
    { instance: 'squat', slug: 'squat', cell: [0, 1] }, // Pine Hollow's spot
    { instance: 'pine-2', slug: 'pine-hollow', cell: [3, 3] }, // Pine Hollow already has a cell
    ...THIN_ICE, { instance: 'corner', slug: 'corner', cell: [-3, -3] },
  ] });
  expect(placed.added.map(cell => cell.instance)).toEqual(['open-plot-thin-ice', 'corner']);
  expect(placed.left).toHaveLength(3);
  expect(placed.document.grid.cells).toHaveLength(27);
  // the box's other two rules: a slug that names a cell, an instance that is a placed slug
  expect(addPlacedCells(document, { kind: 'placement', channel: 'staging', serial: 3, cells: [
    { instance: 'x', slug: 'open-plot-0-0', cell: [3, 0] }, { instance: 'pine-hollow', slug: 'y', cell: [3, 1] }] }).added).toEqual([]);
});

test('a slug neither this build nor the API\'s catalogue cards stays out, and an answer after the page went on installs nothing', async () => {
  const read = await learnPlacedCells(URL_AT, { keep: device, fetch: routes({ [ENTRY_AT]: () => new Response('{"error":"no such shard"}', { status: 404 }) }), publicKey: api.hex, api: API });
  expect(read).toMatchObject({ added: [], left: [expect.stringContaining('not in this build')] });
  expect(gridSlugs()).toHaveLength(25);
  const late = new AbortController();
  const slow: typeof fetch = () => { late.abort(); return Promise.resolve(new Response(signed(), { status: 200 })); };
  expect(await learnPlacedCells(URL_AT, { keep: device, fetch: slow, publicKey: api.hex, signal: late.signal })).toHaveProperty('kept');
  expect(gridSlugs()).toHaveLength(25);
  expect(cards()).toEqual(['driftwood-isle']);
});

test('SA46: a placed slug the build has no card for is carded from its catalogue entry, and `?chunk=` enters its cell', async () => {
  let init: RequestInit | undefined;
  const fetch = routes({ [ENTRY_AT]: asked => { init = asked; return json(ENTRY); } });
  const read = await learnPlacedCells(URL_AT, { keep: device, fetch, publicKey: api.hex, api: API, content: cooked });
  expect(read).toEqual({ added: FRESH, left: [], serial: 1, carded: ['new-author-shard'] });
  expect(fetch.asked).toEqual([URL_AT, ENTRY_AT]);
  expect(init).toMatchObject({ cache: 'no-store', credentials: 'omit', redirect: 'error' });
  expect(gridSlugs()).toHaveLength(26);
  expect(cards()).toEqual(['driftwood-isle', 'new-author-shard']);
  const card = titleCards(false, () => null, () => null, () => true)[1];
  expect(card).toMatchObject({ slug: 'new-author-shard', name: 'Glass Orchard' });
  expect(card?.thumbnail).toMatch(/^data:image\/svg\+xml,/u);
  const cell = oneWayIn({ online: true, hosted: true, slug: 'new-author-shard', kept: false }, new GridAssembly(player));
  expect(cell).toMatchObject({ instance: 'new-author-shard', cell: [1, 3] });
});

test('SA46: a 404, a 500, offline, no CORS, junk, another slug\'s entry, no name or a hung entry leaves the slug out and the build\'s grid whole', async () => {
  const hung = (asked?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => { asked?.signal?.addEventListener('abort', () => { reject(new DOMException('timed out', 'TimeoutError')); }); });
  for (const [why, entry] of [
    ['404', () => json({ error: 'no such shard' }, 404)],
    ['500', () => json({ error: 'oops' }, 500)],
    ['offline or no CORS', () => { throw new TypeError('Failed to fetch'); }],
    ['not json', () => new Response('<html>')],
    ['another slug', () => json({ ...ENTRY, slug: 'driftwood-isle' })],
    ['an empty name', () => json({ ...ENTRY, name: '   ' })],
    ['a name that is not a name', () => json({ ...ENTRY, name: 'x'.repeat(81) })],
    ['no name', () => json({ slug: ENTRY.slug })],
    ['hung (its own deadline, inside the file\'s)', hung],
  ] as const) {
    installCatalogue(PIN); installTitleManifests(ROWS);
    const read = await learnPlacedCells(URL_AT, { keep: device, fetch: routes({ [ENTRY_AT]: entry }), publicKey: api.hex, api: API, cardDeadlineMs: 30 });
    expect(read, why).toMatchObject({ added: [], carded: [], left: [expect.stringContaining('not in this build')] });
    expect(gridSlugs(), why).toHaveLength(25);
    expect(cards(), why).toEqual(['driftwood-isle']);
  }
});

test('SA46: no catalogue read for a slug the build cards, or for a cell the box would refuse', async () => {
  const known = routes({}, signed(THIN_ICE));
  expect(await learnPlacedCells(URL_AT, { keep: device, fetch: known, publicKey: api.hex, api: API })).toMatchObject({ carded: [] });
  expect(known.asked).toEqual([URL_AT]);
  installCatalogue(PIN);
  const squat = routes({ [ENTRY_AT]: () => json(ENTRY) }, signed([{ instance: 'new-author-shard', slug: 'new-author-shard', cell: [0, 1] }]));
  expect(await learnPlacedCells(URL_AT, { keep: device, fetch: squat, publicKey: api.hex, api: API })).toMatchObject({ added: [], carded: [] });
  expect(squat.asked, 'Pine Hollow\'s spot: the box opens nothing there, so nothing is asked').toEqual([URL_AT]);
});

test('SA46: the build\'s own cells go in before the catalogue is asked: a page that goes on mid-lookup keeps them, and a carded card sorts last', async () => {
  const both: Cells = [...THIN_ICE, ...FRESH];
  const page = new AbortController();
  const stalled = routes({ [ENTRY_AT]: asked => new Promise((_resolve, reject) => {
    asked?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); });
    page.abort(); // the page's 3 s ran out while the API was slow
  }) }, signed(both));
  const read = await learnPlacedCells(URL_AT, { keep: device, fetch: stalled, publicKey: api.hex, api: API, signal: page.signal });
  expect(read).toMatchObject({ added: THIN_ICE, carded: [] });
  expect(gridSlugs()).toContain('open-plot-thin-ice');
  expect(gridSlugs()).not.toContain('new-author-shard');
  expect(cards()).toEqual(['driftwood-isle', 'open-plot-thin-ice']);

  installCatalogue(PIN); installTitleManifests(ROWS.map((row, n) => ({ ...row, order: 40 + n })));
  const ok = await learnPlacedCells(URL_AT, { keep: device, fetch: routes({ [ENTRY_AT]: () => json(ENTRY) }, signed(both)), publicKey: api.hex, api: API, content: cooked });
  expect(ok).toEqual({ added: both, left: [], serial: 1, carded: ['new-author-shard'] });
  expect(titleManifests().find(row => row.slug === 'new-author-shard')?.order).toBe(42);
});

// OFFLINE OF20: the last believed file is kept on the device, so an offline Shard Select has the layout it had online
const offline: typeof fetch = () => Promise.reject(new TypeError('Failed to fetch'));
const hung: typeof fetch = (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { reject(new DOMException('timed out', 'TimeoutError')); }); });
const layout = (): unknown => ({ slugs: gridSlugs(), cards: cards(), cell: oneWayIn({ online: true, hosted: true, slug: 'open-plot-thin-ice', kept: false }, new GridAssembly(player)),
  ring: new GridAssembly(player).cells.map(cell => cell.instance) });

test('OF20: offline, the kept file gives the same grid, card, cell and neighbours as online', async () => {
  await learnPlacedCells(URL_AT, { keep: device, fetch: answering(signed()), publicKey: api.hex });
  const online = layout();
  expect(device.kept.get(URL_AT)).toBe(signed());
  // the next page, offline: the build's grid again, then the kept file
  installCatalogue(PIN); installTitleManifests(ROWS);
  const read = await learnPlacedCells(URL_AT, { keep: device, fetch: offline, publicKey: api.hex });
  expect(read).toEqual({ added: THIN_ICE, left: [], serial: 1, carded: [], cached: 'Failed to fetch' });
  expect(layout()).toEqual(online);
});

test('OF20: a read that hangs past the page\'s deadline still leaves the kept layout installed', async () => {
  device.write(URL_AT, signed());
  const late = new AbortController();
  const reading = learnPlacedCells(URL_AT, { keep: device, fetch: hung, publicKey: api.hex, signal: late.signal, deadlineMs: 60_000 });
  await vi.waitFor(() => { expect(gridSlugs()).toHaveLength(26); });
  late.abort(); // the boot goes on with what is installed
  expect(gridSlugs()).toHaveLength(26);
  await reading;
});

test('OF20: a fresh file replaces the kept one\'s cells; a 404 drops them; a kept file under another key is dropped', async () => {
  device.write(URL_AT, signed());
  const moved = [{ instance: 'open-plot-thin-ice', slug: 'open-plot-thin-ice', cell: [3, 0] }] as const;
  expect(await learnPlacedCells(URL_AT, { keep: device, fetch: answering(signed(moved, 2)), publicKey: api.hex })).toEqual({ added: moved, left: [], serial: 2, carded: [] });
  expect(oneWayIn({ online: true, hosted: true, slug: 'open-plot-thin-ice', kept: false }, new GridAssembly(player))).toMatchObject({ cell: [3, 0] });
  expect(device.kept.get(URL_AT)).toBe(signed(moved, 2));
  installCatalogue(PIN);
  expect(await learnPlacedCells(URL_AT, { keep: device, fetch: answering('', 404), publicKey: api.hex })).toHaveProperty('kept');
  expect(gridSlugs()).toHaveLength(25);
  expect(device.kept.has(URL_AT)).toBe(false);
  device.write(URL_AT, signed(THIN_ICE, 1, 'staging', pair().privateKey));
  expect(await learnPlacedCells(URL_AT, { keep: device, fetch: offline, publicKey: api.hex })).toEqual({ kept: 'Failed to fetch' });
  expect(gridSlugs()).toHaveLength(25);
  expect(device.kept.has(URL_AT)).toBe(false);
});

test('OF20: the device keep shares OF0\'s gridRoute slot and leaves the kept world word alone', async () => {
  const { devicePlacedKeep } = await import('../src/client/game/grid/placedCells');
  const { deviceRouteMemory } = await import('../src/client/game/grid/oneWayIn');
  const route = deviceRouteMemory(), keep = devicePlacedKeep(), release = 'https://packs.example/releases/staging.json';
  route.write(release, true, ['driftwood-isle']);
  keep.write(URL_AT, signed());
  expect(route.read(release)).toBe(true);
  route.write(release, true, ['driftwood-isle', 'open-plot-thin-ice']);
  expect(keep.read(URL_AT)).toBe(signed());
  expect(route.shards(release)).toEqual(['driftwood-isle', 'open-plot-thin-ice']);
  keep.write(URL_AT, null);
  expect(keep.read(URL_AT)).toBeNull();
  expect(route.read(release)).toBe(true);
});

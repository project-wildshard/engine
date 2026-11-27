// @vitest-environment happy-dom
// SHARD-AUTHORING SA48: a shard the API placed after this page was built enters from the cook's packs. SA46 cards it from the API's
// catalogue; this page reads the cook's `index/<build>/<hash>.json` (the hash the signed placement file names, SA47 (1)) from the store
// in the packs bucket, and each manifest it names. The spawn download then reads the shard from that store on either flow, its
// header admitted by the cook's verdict under this page's own validator. Anything else leaves the slug out, as SA46 does.
// oxlint-disable-next-line import/no-nodejs-modules -- It signs as the API does, and hashes as the cook does.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installCatalogue, installedCatalogue } from '../src/shared/game/grid/catalogueSlot';
import { learnPlacedCells } from '../src/client/game/grid/placedCells';
import { placedContent, type PlacedContentPorts } from '../src/client/game/grid/placedContent';
import { clearPlacedSpawns, devCookedMap, placedLoose, placedSpawn } from '../src/client/game/boot/placedSpawn';
import { entryProgramsURL, setSpawnPacks, startSpawnDownload } from '../src/client/game/boot/spawnDownload';
import { installTitleManifests, titleManifests, type TitleManifest } from '../src/client/game/shard/titleList';
import { cookReceipt } from '../src/cook/game/cookJob';
import { catalogueBeforePlacements } from './fixtures/catalogue-before-placements';

const SLUG = 'new-author-shard', HASH = 'a'.repeat(64), BUILD = 'b1', VALIDATOR = 'f'.repeat(64);
test('a dev map stamp serves the two cook sizes for the local shard', () => {
  expect(devCookedMap(SLUG, 'full', SLUG)).toBe(`/shardfiles/${SLUG}/cooked-map-v1.png`);
  expect(devCookedMap(`_${SLUG}`, 'cell', SLUG)).toBe(`/shardfiles/${SLUG}/cooked-map-v1-cell.png`);
  expect(devCookedMap(SLUG, 'cell', undefined)).toBeUndefined();
  expect(devCookedMap(SLUG, 'cell', 'another-shard')).toBeUndefined();
});
const PACKS = 'https://packs.wildshard.io/', URL_AT = 'https://releases.wildshard.io/staging-placements.json', API = 'https://api.example';
const ENTRY_AT = `${API}/api/catalogue/shards/${SLUG}`, INDEX_AT = `${PACKS}index/${BUILD}/${HASH}.json`;
const key = generateKeyPairSync('ed25519'), publicKey = key.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
const placement = (cells: readonly unknown[]): string => {
  const body = JSON.stringify({ kind: 'placement', channel: 'staging', serial: 1, cells });
  return JSON.stringify({ body, signature: sign(null, Buffer.from(body), key.privateKey).toString('hex') });
};
const CELL = { instance: SLUG, slug: SLUG, cell: [1, 3], hash: HASH };

// the cook's store: four manifests (entry and whole, phone and desktop) and the index that names them
const HEADER = '/shardfiles/new-author-shard/shard.json?v=0123abcd';
const manifest = (tier: 'phone' | 'desktop', set: 'entry' | 'whole'): string => JSON.stringify({ version: 1, shard: SLUG, tier, flow: 'client', totalBytes: set === 'entry' ? 12 : 17,
  files: [{ url: HEADER, bytes: 12, hash: 'c'.repeat(64) }, ...set === 'whole' ? [{ url: '/shardfiles/new-author-shard/ground.bin', bytes: 5, hash: 'd'.repeat(64) }] : []] });
const NAMES = { 'entry-phone': '1', 'entry-desktop': '2', 'whole-phone': '3', 'whole-desktop': '4' } as const;
const ROWS = (['phone', 'desktop'] as const).flatMap(tier => (['entry', 'whole'] as const).map(set => ({
  url: `/assets/spawn/${SLUG}-${set}-${tier}-${NAMES[`${set}-${tier}`].repeat(16)}.json`, tier, set, files: set === 'entry' ? 1 : 2, totalBytes: set === 'entry' ? 12 : 17, wireBytes: 0, body: manifest(tier, set) })));
const VERDICT = { revision: VALIDATOR, sourceHash: 'e'.repeat(64), indexHash: 'c'.repeat(64), residentBytes: 4096, postCost: { passes: 0, instructions: 0, inputs: { colour: false, depth: false, normal: false } },
  worst: { playing: 1, loading: 1, accounted: 1, location: [0, 0] } };
const INDEX = { version: 1, build: BUILD, slug: SLUG, hash: HASH, header: `shardfiles/${SLUG}/shard.json`, manifests: ROWS.map(({ body: _body, ...row }) => row),
  keys: [`shardfiles/${SLUG}/shard.json`, `programs/${SLUG}.json`, `loose/${HASH}/shardfiles/${SLUG}/shard.json`, `loose/${HASH}/programs/${SLUG}.json`], loose: `loose/${HASH}/`, server: { files: 1, bytes: 1 }, proof: 'proved', seconds: 1, verdict: VERDICT };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// HERO-GATE HG4: the hero the upload carried, as the cook copies it: a discovery document whose card names three mounted images
const IMAGE = (n: string): string => `/shardfiles/${SLUG}/blobs/image/${n.repeat(64)}.jpg`;
const HERO = { thumb: IMAGE('1'), portrait: IMAGE('2'), landscape: IMAGE('3') };
const LOOSE = (path: string): string => `loose/${HASH}/${path.slice(1)}`;
const DISCOVERY_AT = `${PACKS}${LOOSE(`/shardfiles/${SLUG}/discovery.json`)}`;
const HEROED = { ...INDEX, keys: [...INDEX.keys, LOOSE(`/shardfiles/${SLUG}/discovery.json`), ...Object.values(HERO).map(LOOSE)] };

/** The placement file, the API's entry and the store; `index` and `body` stand in for what the store holds, `discovery` for the
 *  upload's discovery document (HG4). */
function store(index: (asked: string) => Response = () => json(INDEX), body: (row: typeof ROWS[number]) => string = row => row.body, cells: readonly unknown[] = [CELL],
  discovery: () => Response = () => json({ version: 1, slug: SLUG, data: { card: HERO } })): typeof fetch & { readonly asked: string[] } {
  const asked: string[] = [];
  const answer = function (this: unknown, url: string | URL | Request): Promise<Response> {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    const at = url instanceof Request ? url.url : String(url);
    asked.push(at);
    if (at === URL_AT) return Promise.resolve(new Response(placement(cells)));
    if (at === ENTRY_AT) return Promise.resolve(json({ slug: SLUG, name: 'Glass Orchard' }));
    if (at.startsWith(`${INDEX_AT}?t=`)) return Promise.resolve(index(at));
    if (at === DISCOVERY_AT) return Promise.resolve(discovery());
    const row = ROWS.find(item => `${PACKS}${item.url.slice(1)}` === at);
    return Promise.resolve(row === undefined ? new Response('', { status: 404 }) : new Response(body(row)));
  };
  return Object.assign(answer, { asked }) as typeof fetch & { readonly asked: string[] };
}
const PIN = catalogueBeforePlacements;
const TITLE: readonly TitleManifest[] = [{ slug: 'driftwood-isle', name: 'Driftwood Isle', biome: '', status: 'live', card: { thumb: '/t.jpg', portrait: '/p.jpg', landscape: '/l.jpg' } }];
const verdicts = (): unknown[] => Reflect.get(globalThis, '__WS_SHARDFILE_VERDICTS__') as unknown[];
const gridSlugs = (): readonly string[] => (installedCatalogue()?.grid.cells ?? []).map(cell => cell.slug);
const learn = (read: typeof fetch): ReturnType<typeof learnPlacedCells> => learnPlacedCells(URL_AT, { fetch: read, publicKey, api: API });

beforeEach(() => {
  installCatalogue(PIN); installTitleManifests(TITLE); clearPlacedSpawns();
  Object.assign(globalThis, { __WS_BUILD_ID__: BUILD, __WS_SHARDFILE_VALIDATOR__: VALIDATOR, __WS_SHARDFILE_VERDICTS__: [{ path: '/shardfiles/driftwood-isle/shard.json' }] });
  document.body.innerHTML = `<script type="application/json" id="boot-module-files">${JSON.stringify({ spawnManifests: { client: {}, grid: { '000': {} }, cacheName: 'ws-test' } })}</script>`;
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, Symbol.for('game.catalogue'));
  for (const name of ['__WS_BUILD_ID__', '__WS_SHARDFILE_VALIDATOR__', '__WS_SHARDFILE_VERDICTS__']) Reflect.deleteProperty(globalThis, name);
  clearPlacedSpawns();
});

test('SA48 and RL10: a carded slug takes signed placement from releases and cooked content from packs', async () => {
  const fetch = store(), read = await learn(fetch);
  expect(read).toMatchObject({ added: [{ instance: SLUG, slug: SLUG, cell: [1, 3] }], left: [], carded: [SLUG] });
  expect(gridSlugs()).toContain(SLUG);
  expect(fetch.asked.filter(at => at.startsWith('https://releases.wildshard.io/'))).toEqual([URL_AT]);
  // the index asks past the CDN's cached 404; each manifest is read once, by its content name
  expect(fetch.asked.filter(at => at.startsWith(INDEX_AT))).toHaveLength(1);
  expect(fetch.asked.filter(at => at.includes('/assets/spawn/')).sort()).toEqual(ROWS.map(row => `${PACKS}${row.url.slice(1)}`).sort());
  const spawn = placedSpawn(SLUG);
  expect(spawn).toMatchObject({ slug: SLUG, base: PACKS, loose: `${PACKS}loose/${HASH}/`, programs: true });
  // its loose files are this upload's, never the slug's own keys (the last cook's, perhaps another channel's upload)
  expect(placedLoose(`/shardfiles/${SLUG}/shard.json`, '?v=0123abcd')).toBe(`${PACKS}loose/${HASH}/shardfiles/${SLUG}/shard.json?v=0123abcd`);
  expect(placedLoose('/shardfiles/driftwood-isle/shard.json'), 'a shard the build has').toBeUndefined();
  expect(placedLoose(`/assets/spawn/${SLUG}-entry-phone-1111111111111111.json`), 'not a loose path').toBeUndefined();
  expect(spawn?.entry.phone).toEqual({ url: ROWS[0]?.url, bytes: ROWS[0]?.body.length, totalBytes: 12, files: 1, wireBytes: 0 });
  expect(spawn?.whole.desktop).toMatchObject({ url: ROWS[3]?.url, totalBytes: 17, files: 2 });
  expect(placedSpawn(`_${SLUG}`), 'a grid slug finds its product').toBe(spawn);
  // the build's verdicts gain the cook's, at the header's path, under this page's validator
  expect(verdicts()).toEqual([{ path: '/shardfiles/driftwood-isle/shard.json' }, { ...VERDICT, path: `/shardfiles/${SLUG}/shard.json` }]);
});

test('SA48: the spawn download reads a placed slug\'s rows on both flows, from the store, with its programs', async () => {
  await learn(store());
  expect(entryProgramsURL(SLUG)).toBe(`${PACKS}loose/${HASH}/programs/${SLUG}.json`);
  const read: string[] = [];
  const parked = window.fetch;
  window.fetch = (url: string | URL | Request): Promise<Response> => { read.push(String(url instanceof Request ? url.url : url)); return new Promise(() => undefined); };
  try {
    setSpawnPacks(false);
    // a grid entry (no build has its grid manifest) reads the cook's entry manifest from the store
    const download = startSpawnDownload(SLUG, 'grid', 'phone');
    expect(download).not.toBeNull();
    await vi.waitFor(() => { expect(read, 'the entry manifest from the store').toContain(`${PACKS}${ROWS[0]?.url.slice(1) ?? ''}`); }, { timeout: 5000 });
    // the same manifest is the same download on the client flow (its key is the address)
    expect(startSpawnDownload(SLUG, 'client', 'phone')).toBe(download);
    download?.cancel();
    expect(startSpawnDownload('no-such-shard', 'grid', 'phone'), 'a slug neither the build nor the cook has').toBeNull();
  } finally { window.fetch = parked; }
});

test('SA48: no hash, no index yet, junk, another build\'s, slug\'s or bytes\' index, another validator or a manifest that is not its row leaves the slug out', async () => {
  for (const [why, fetch] of [
    ['a cell from before SA47 (no hash)', store(undefined, undefined, [{ instance: SLUG, slug: SLUG, cell: [1, 3] }])],
    ['not cooked yet (404)', store(() => json({ error: 'no' }, 404))],
    ['not json', store(() => new Response('<html>'))],
    ['another build\'s index', store(() => json({ ...INDEX, build: 'b0' }))],
    ['another slug\'s index', store(() => json({ ...INDEX, slug: 'driftwood-isle', header: 'shardfiles/driftwood-isle/shard.json' }))],
    ['other bytes\' index', store(() => json({ ...INDEX, hash: 'b'.repeat(64) }))],
    ['an index from before SA48\'s loose copies', store(() => json({ ...INDEX, loose: undefined }))],
    ['another upload\'s loose copies', store(() => json({ ...INDEX, loose: `loose/${'b'.repeat(64)}/` }))],
    ['another validator', store(() => json({ ...INDEX, verdict: { ...VERDICT, revision: '0'.repeat(64) } }))],
    ['a cook with no verdict', store(() => json({ ...INDEX, verdict: undefined }))],
    ['a manifest that is not its row', store(undefined, row => row.body.replace('"totalBytes":17', '"totalBytes":18'))],
    ['a manifest of another shard', store(undefined, row => row.body.replaceAll(SLUG, 'driftwood-isle'))],
    ['a missing manifest', store(undefined, () => { throw new TypeError('Failed to fetch'); })],
  ] as const) {
    installCatalogue(PIN); installTitleManifests(TITLE); clearPlacedSpawns();
    const read = await learn(fetch);
    expect(read, why).toMatchObject({ added: [], carded: [], left: [expect.stringContaining('not in this build')] });
    expect(gridSlugs(), why).toHaveLength(22);
    expect(placedSpawn(SLUG), why).toBeUndefined();
    expect(verdicts(), why).toHaveLength(1);
  }
});

test('HERO-GATE HG4: a placed card wears the hero its upload carried, from the cook\'s copy of its discovery card', async () => {
  const read = await learn(store(() => json(HEROED)));
  expect(read).toMatchObject({ carded: [SLUG] });
  const row = titleManifests().find(item => item.slug === SLUG);
  expect(row?.card).toEqual({ thumb: `${PACKS}${LOOSE(HERO.thumb)}`, portrait: `${PACKS}${LOOSE(HERO.portrait)}`, landscape: `${PACKS}${LOOSE(HERO.landscape)}` });
  expect(row?.status, 'a player\'s card').toBe('live');
});

test('HERO-GATE HG4: a placed slug with no hero keeps its cell, its card Developer only', async () => {
  const data = 'data:image/svg+xml,%3Csvg%2F%3E';
  for (const [why, fetch] of [
    ['no discovery in the cook\'s keys', store()],
    ['the generated card', store(() => json(HEROED), undefined, undefined, () => json({ data: { card: { thumb: data, portrait: data, landscape: data } } }))],
    ['an image the cook did not copy', store(() => json({ ...HEROED, keys: HEROED.keys.filter(key => !key.endsWith(`${'3'.repeat(64)}.jpg`)) }))],
    ['another shard\'s image', store(() => json(HEROED), undefined, undefined, () => json({ data: { card: { ...HERO, thumb: '/shardfiles/driftwood-isle/blobs/image/' + '1'.repeat(64) + '.jpg' } } }))],
    ['no discovery document (404)', store(() => json(HEROED), undefined, undefined, () => json({ error: 'no' }, 404))],
    ['junk', store(() => json(HEROED), undefined, undefined, () => new Response('<html>'))],
  ] as const) {
    installCatalogue(PIN); installTitleManifests(TITLE); clearPlacedSpawns();
    const read = await learn(fetch);
    expect(read, why).toMatchObject({ carded: [SLUG] });
    expect(gridSlugs(), why).toContain(SLUG);
    expect(placedSpawn(SLUG), why).toBeDefined();
    expect(titleManifests().find(item => item.slug === SLUG)?.status, why).toBe('hidden');
  }
});

test('SA48: a page with no validator (the dev server) asks for no verdict and adds none', async () => {
  for (const name of ['__WS_SHARDFILE_VALIDATOR__', '__WS_SHARDFILE_VERDICTS__']) Reflect.deleteProperty(globalThis, name);
  const ports: PlacedContentPorts = { fetch: store(() => json({ ...INDEX, verdict: undefined })), signal: new AbortController().signal, packs: PACKS, build: BUILD, validator: null };
  expect(await placedContent(SLUG, HASH, ports)).toMatchObject({ spawn: { slug: SLUG }, verdict: null });
  expect(await placedContent(SLUG, HASH, { ...ports, packs: 'https://packs.example' }), 'a store root is a folder').toBeUndefined();
  expect(await placedContent(SLUG, 'nothex', ports)).toBeUndefined();
});

test('SA48: the cook\'s receipt is the validated product\'s, held as a build holds its own', () => {
  const header = new TextEncoder().encode(JSON.stringify({ build: { sourceHash: 'e'.repeat(64) } })), indexHash = createHash('sha256').update(header).digest('hex');
  const receipt = { revision: '1'.repeat(64), sourceHash: 'e'.repeat(64), indexHash, residentBytes: 4096, postCost: VERDICT.postCost, worst: VERDICT.worst };
  const files = (row: unknown): Map<string, Uint8Array> => new Map([['shard.json', header], ['validation.json', new TextEncoder().encode(JSON.stringify(row))]]);
  // the worker stamps its own revision: the author's tools' is not the page's question
  expect(cookReceipt(files(receipt))).toEqual({ sourceHash: 'e'.repeat(64), indexHash, residentBytes: 4096, postCost: VERDICT.postCost, worst: VERDICT.worst });
  expect(cookReceipt(files({ ...receipt, indexHash: 'c'.repeat(64) })), 'another header').toBeUndefined();
  expect(cookReceipt(files({ ...receipt, sourceHash: 'd'.repeat(64) })), 'another source').toBeUndefined();
  expect(cookReceipt(files({ ...receipt, residentBytes: 0 })), 'no residency').toBeUndefined();
  expect(cookReceipt(files({ ...receipt, postCost: undefined })), 'no post cost').toBeUndefined();
  expect(cookReceipt(new Map([['shard.json', header]])), 'no receipt').toBeUndefined();
});

// @vitest-environment happy-dom
// SHARD-AUTHORING SA48: a shard the API placed after this page was built enters from the cook's packs. SA46 cards it from the API's
// catalogue; this page reads the cook's `index/<build>/<hash>.json` (the hash the signed placement file names, SA47 (1)) from the store
// beside the placement file, and each manifest it names, and the spawn download then reads the shard from that store on either flow, its
// header admitted by the cook's verdict under this page's own validator. Anything else leaves the slug out, as SA46 does.
// oxlint-disable-next-line import/no-nodejs-modules -- It signs as the API does, and hashes as the cook does.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- the catalogue pin.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { installCatalogue, installedCatalogue } from '../src/shared/game/grid/catalogueSlot';
import { learnPlacedCells } from '../src/client/game/grid/placedCells';
import { placedContent, type PlacedContentPorts } from '../src/client/game/grid/placedContent';
import { clearPlacedSpawns, placedSpawn } from '../src/client/game/boot/placedSpawn';
import { entryProgramsURL, setSpawnPacks, startSpawnDownload } from '../src/client/game/boot/spawnDownload';
import { installTitleManifests, type TitleManifest } from '../src/client/game/shard/titleList';
import { cookReceipt } from '../src/cook/game/cookJob';

const SLUG = 'new-author-shard', HASH = 'a'.repeat(64), BUILD = 'b1', VALIDATOR = 'f'.repeat(64);
const PACKS = 'https://packs.example/', URL_AT = `${PACKS}releases/staging-placements.json`, API = 'https://api.example';
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
  keys: [`shardfiles/${SLUG}/shard.json`, `programs/${SLUG}.json`], server: { files: 1, bytes: 1 }, proof: 'proved', seconds: 1, verdict: VERDICT };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The placement file, the API's entry and the store; `index` and `body` stand in for what the store holds. */
function store(index: (asked: string) => Response = () => json(INDEX), body: (row: typeof ROWS[number]) => string = row => row.body, cells: readonly unknown[] = [CELL]): typeof fetch & { readonly asked: string[] } {
  const asked: string[] = [];
  const answer = function (this: unknown, url: string | URL | Request): Promise<Response> {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    const at = url instanceof Request ? url.url : String(url);
    asked.push(at);
    if (at === URL_AT) return Promise.resolve(new Response(placement(cells)));
    if (at === ENTRY_AT) return Promise.resolve(json({ slug: SLUG, name: 'Glass Orchard' }));
    if (at.startsWith(`${INDEX_AT}?t=`)) return Promise.resolve(index(at));
    const row = ROWS.find(item => `${PACKS}${item.url.slice(1)}` === at);
    return Promise.resolve(row === undefined ? new Response('', { status: 404 }) : new Response(body(row)));
  };
  return Object.assign(answer, { asked }) as typeof fetch & { readonly asked: string[] };
}
const PIN = JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8')) as Parameters<typeof installCatalogue>[0];
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

test('SA48: a carded slug takes the cook\'s content from the store beside the placement file, and its header\'s admission row', async () => {
  const fetch = store(), read = await learn(fetch);
  expect(read).toMatchObject({ added: [{ instance: SLUG, slug: SLUG, cell: [1, 3] }], left: [], carded: [SLUG] });
  expect(gridSlugs()).toContain(SLUG);
  // the index asks past the CDN's cached 404; each manifest is read once, by its content name
  expect(fetch.asked.filter(at => at.startsWith(INDEX_AT))).toHaveLength(1);
  expect(fetch.asked.filter(at => at.includes('/assets/spawn/')).sort()).toEqual(ROWS.map(row => `${PACKS}${row.url.slice(1)}`).sort());
  const spawn = placedSpawn(SLUG);
  expect(spawn).toMatchObject({ slug: SLUG, base: PACKS, programs: true });
  expect(spawn?.entry.phone).toEqual({ url: ROWS[0]?.url, bytes: ROWS[0]?.body.length, totalBytes: 12, files: 1, wireBytes: 0 });
  expect(spawn?.whole.desktop).toMatchObject({ url: ROWS[3]?.url, totalBytes: 17, files: 2 });
  expect(placedSpawn(`_${SLUG}`), 'a grid slug finds its product').toBe(spawn);
  // the build's verdicts gain the cook's, at the header's path, under this page's validator
  expect(verdicts()).toEqual([{ path: '/shardfiles/driftwood-isle/shard.json' }, { ...VERDICT, path: `/shardfiles/${SLUG}/shard.json` }]);
});

test('SA48: the spawn download reads a placed slug\'s rows on both flows, from the store, with its programs', async () => {
  await learn(store());
  expect(entryProgramsURL(SLUG)).toBe(`${PACKS}programs/${SLUG}.json`);
  const read: string[] = [];
  const parked = window.fetch;
  window.fetch = (url: string | URL | Request): Promise<Response> => { read.push(String(url instanceof Request ? url.url : url)); return new Promise(() => undefined); };
  try {
    setSpawnPacks(false);
    for (const flow of ['client', 'grid'] as const) {
      const download = startSpawnDownload(SLUG, flow, 'phone');
      expect(download, flow).not.toBeNull();
      await new Promise(resolve => { setTimeout(resolve, 20); });
      download?.cancel();
    }
    expect(startSpawnDownload('no-such-shard', 'grid', 'phone'), 'a slug neither the build nor the cook has').toBeNull();
    expect(read.some(at => at === `${PACKS}${ROWS[0]?.url.slice(1) ?? ''}`), `the entry manifest from the store: ${read.join(', ')}`).toBe(true);
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
    ['another validator', store(() => json({ ...INDEX, verdict: { ...VERDICT, revision: '0'.repeat(64) } }))],
    ['a cook with no verdict', store(() => json({ ...INDEX, verdict: undefined }))],
    ['a manifest that is not its row', store(undefined, row => row.body.replace('"totalBytes":17', '"totalBytes":18'))],
    ['a manifest of another shard', store(undefined, row => row.body.replaceAll(SLUG, 'driftwood-isle'))],
    ['a missing manifest', store(undefined, () => { throw new TypeError('Failed to fetch'); })],
  ] as const) {
    installCatalogue(PIN); installTitleManifests(TITLE); clearPlacedSpawns();
    const read = await learn(fetch);
    expect(read, why).toMatchObject({ added: [], carded: [], left: [expect.stringContaining('not in this build')] });
    expect(gridSlugs(), why).toHaveLength(25);
    expect(placedSpawn(SLUG), why).toBeUndefined();
    expect(verdicts(), why).toHaveLength(1);
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

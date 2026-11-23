// SHARD-COMPAT NB2 (J494, Jake 2026-11-22: "the page should always run the server revision"). P1, 2026-11-22: staging's page baked
// Driftwood r8 while its rooms ran r9 (an upload moves a catalogue cell's hash, `uploadActivation.ts`), and every enemy was invisible.
// The page now follows the hash the signed placement file names for a slug it baked: it draws the rooms' upload, or refuses with Reload.
// oxlint-disable-next-line import/no-nodejs-modules -- It signs as the API does.
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { installCatalogue, installedCatalogue, type CatalogueDocument } from '../src/shared/game/grid/catalogueSlot';
import { learnPlacedCells, roomsRevisions, type PlacedKeep } from '../src/client/game/grid/placedCells';
import type { PlacedContent } from '../src/client/game/grid/placedContent';
import { behindRooms, clearPlacedSpawns, placedLoose, placedSpawn } from '../src/client/game/boot/placedSpawn';
import { clearFollowed, heardRooms, pageRevision, type RoomsHints } from '../src/client/game/grid/roomsRevision';
import { worldRevisions } from '../src/server/host/dedicated/gridCells';
import { catalogueBeforePlacements } from './fixtures/catalogue-before-placements';

const URL_AT = 'https://packs.example/releases/staging-placements.json';
const key = generateKeyPairSync('ed25519'), publicKey = key.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
// Driftwood's page bake (r8 on staging v0.1.72) and the rooms' upload (r9): stand-in hashes, since the rule reads no shard bytes (NB10)
const R8 = 'a8'.repeat(32);
const R9 = 'b9'.repeat(32);
const PAGE: CatalogueDocument = { ...catalogueBeforePlacements,
  shards: (catalogueBeforePlacements.shards ?? []).map(row => row.slug === 'driftwood-isle' ? { ...row, revision: 8, hash: R8 } : row) };
const own = PAGE.grid.cells.find(row => row.slug === 'driftwood-isle') as { readonly instance: string; readonly slug: string; readonly cell: readonly [number, number] };
const signed = (hash: string): string => {
  const body = JSON.stringify({ kind: 'placement', channel: 'staging', serial: 83, cells: [{ instance: own.instance, slug: own.slug, cell: own.cell, hash }] });
  return JSON.stringify({ body, signature: sign(null, Buffer.from(body), key.privateKey).toString('hex') });
};
const serving = (text: string): typeof fetch => () => Promise.resolve(new Response(text, { status: 200 }));
const keep = (): PlacedKeep => ({ read: () => null, write: () => undefined });
const R9_COPY: PlacedContent = { spawn: { slug: 'driftwood-isle', entry: { phone: { path: `/loose/${R9}/m.json`, bytes: 1, sha256: 'a'.repeat(64) } as never },
  whole: {}, base: 'https://packs.example/', loose: `https://packs.example/loose/${R9}/`, programs: true }, verdict: null };

const tab = (): RoomsHints & { held: Parameters<RoomsHints['write']>[0] } => {
  const box = { held: { revisions: {}, reloaded: {} } as Parameters<RoomsHints['write']>[0], read: () => box.held, write: (hints: Parameters<RoomsHints['write']>[0]) => { box.held = hints; } };
  return box;
};
beforeEach(() => { installCatalogue(PAGE); clearPlacedSpawns(); clearFollowed(); });
afterEach(() => { Reflect.deleteProperty(globalThis, Symbol.for('game.catalogue')); clearPlacedSpawns(); clearFollowed(); });

test('the r8 page / r9 rooms split: the page draws r9, the rooms\' own upload, by its hash', async () => {
  expect(own).toBeDefined();
  expect(roomsRevisions(PAGE, { kind: 'placement', channel: 'staging', serial: 83, cells: [{ ...own, cell: [own.cell[0], own.cell[1]], hash: R9 }] } as never))
    .toEqual(new Map([['driftwood-isle', R9]]));
  const asked: string[] = [];
  const read = await learnPlacedCells(URL_AT, { keep: keep(), hints: tab(), fetch: serving(signed(R9)), publicKey,
    content: (slug, hash) => { asked.push(`${slug}@${String(hash)}`); return Promise.resolve(R9_COPY); } });
  expect(asked).toEqual([`driftwood-isle@${R9}`]);
  expect(read).toMatchObject({ followed: ['driftwood-isle'], behind: [] });
  expect(placedSpawn('driftwood-isle')?.loose).toContain(R9);
  // its header, sections and programs come from r9's own copy, never the page's baked r8
  expect(placedLoose('/shardfiles/driftwood-isle/shard.json', '?v=1')).toBe(`https://packs.example/loose/${R9}/shardfiles/driftwood-isle/shard.json?v=1`);
  expect(behindRooms('driftwood-isle')).toBeUndefined();
  // the grid is the build's own: the cell is kept once
  expect(installedCatalogue()?.grid.cells.filter(row => row.slug === 'driftwood-isle')).toHaveLength(1);
});

test('r9 that the page cannot load: entering Driftwood refuses with Reload, never a mismatch', async () => {
  const read = await learnPlacedCells(URL_AT, { keep: keep(), hints: tab(), fetch: serving(signed(R9)), publicKey, content: () => Promise.resolve(undefined) });
  expect(read).toMatchObject({ followed: [], behind: ['driftwood-isle'] });
  expect(behindRooms('driftwood-isle')).toBe(R9);
  expect(placedSpawn('driftwood-isle')).toBeUndefined();
});

test('rooms that run what the page baked, or a file that names no hash, change nothing', async () => {
  const read = await learnPlacedCells(URL_AT, { keep: keep(), hints: tab(), fetch: serving(signed(R8)), publicKey, content: () => { throw new Error('no read'); } });
  expect(read).not.toHaveProperty('followed');
  expect(behindRooms('driftwood-isle')).toBeUndefined();
  expect(placedSpawn('driftwood-isle')).toBeUndefined();
});

test('today\'s staging: the signed file names no Driftwood, the rooms\' world word does; the page reloads once and boots on r9', async () => {
  // the door: Driftwood's cell moved to the r9 upload, every other cell on the release's bytes
  const word = { cells: 2, shards: ['driftwood-isle', 'pine-hollow'], ...worldRevisions(['driftwood-isle', 'pine-hollow'], slug => slug === 'driftwood-isle' ? R9 : undefined) };
  expect(word.revisions).toEqual({ 'driftwood-isle': R9 });
  const hints = tab();
  let reloads = 0;
  expect(pageRevision('driftwood-isle')).toBe(R8);
  expect(heardRooms(word, 'driftwood-isle', hints, () => { reloads++; })).toBe('reload');
  expect(heardRooms(word, 'pine-hollow', hints, () => { reloads++; })).toBe('same');
  expect(reloads).toBe(1);
  // the next boot: a placement file with no Driftwood row (api-server names only the cells the baked grid lacks)
  const none = JSON.stringify({ kind: 'placement', channel: 'staging', serial: 84, cells: [] });
  const file = JSON.stringify({ body: none, signature: sign(null, Buffer.from(none), key.privateKey).toString('hex') });
  const read = await learnPlacedCells(URL_AT, { keep: keep(), hints, fetch: serving(file), publicKey, content: (_slug, hash) => Promise.resolve(hash === R9 ? R9_COPY : undefined) });
  expect(read).toMatchObject({ followed: ['driftwood-isle'] });
  expect(pageRevision('driftwood-isle')).toBe(R9);
  expect(heardRooms(word, 'driftwood-isle', hints, () => { reloads++; })).toBe('same');
  expect(reloads).toBe(1);
});

test('a page that still cannot draw the rooms\' bytes after its one reload never reloads again', () => {
  const word = { cells: 1, shards: ['driftwood-isle'], revisions: { 'driftwood-isle': R9 } }, hints = tab();
  let reloads = 0;
  expect(heardRooms(word, 'driftwood-isle', hints, () => { reloads++; })).toBe('reload');
  expect(heardRooms(word, 'driftwood-isle', hints, () => { reloads++; })).toBe('behind');
  expect(reloads).toBe(1);
  // an older door names no revisions: nothing changes
  expect(heardRooms({ cells: 1, shards: ['driftwood-isle'] }, 'driftwood-isle', tab(), () => { reloads++; })).toBe('same');
  expect(worldRevisions(['pine-hollow'], () => undefined)).toEqual({});
});

test('the release chain: a zone whose rooms run bytes the page neither baked nor can follow is a P0', async () => {
  const { roomsRevisionFindings } = await import('../scripts/rooms-revision-check');
  const html = `<script>__WS_BUILD_ID__="b1"</script><script type="application/json" id="ws-catalogue">${JSON.stringify({ shards: [{ slug: 'driftwood-isle', hash: R8 }] })}</script>`;
  const read = (indexed: boolean) => (url: string): Promise<Response> => Promise.resolve(url.includes('/index/') ? new Response(null, { status: indexed ? 200 : 404 }) : new Response(html));
  const word = (): Promise<{ readonly revisions: Readonly<Record<string, string>> }> => Promise.resolve({ cells: 1, shards: ['driftwood-isle'], revisions: { 'driftwood-isle': R9 } });
  expect(await roomsRevisionFindings({ origin: 'https://s', socket: 'wss://r', read: read(false), word })).toMatchObject([{ key: 'behind-driftwood-isle', severity: 'P0' }]);
  expect(await roomsRevisionFindings({ origin: 'https://s', socket: 'wss://r', read: read(true), word })).toEqual([]);
  expect(await roomsRevisionFindings({ origin: 'https://s', socket: 'wss://r', read: read(true), word: () => Promise.resolve(null) })).toMatchObject([{ severity: 'P2' }]);
});

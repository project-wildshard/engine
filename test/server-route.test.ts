import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The rule is read where the page applies it.
import { readFileSync } from 'node:fs';
import { earlyStandalone, hostsGrid, opensShard, serverRoute } from '../src/client/game/shardfile/serverRoute';
import { shardCell } from '../src/client/game/grid/oneWayIn';

// GO4 (QA row 13, "let's make it all the same"): an online build's grid page plays on the world, like a one-shard page.
const WORLD = { release: 'https://packs.example/releases/staging.json', key: 'ab' }, STORAGE = {};

test('the gate, both sides: a grid page joins the world only once the world hosts the grid; else today\'s solo grid', () => {
  expect(serverRoute(WORLD, STORAGE), 'a one-shard page joins the world').toBe('online');
  expect(serverRoute(WORLD, STORAGE, { page: false, hosted: false }), 'a one-shard page, whatever the grid').toBe('online');
  expect(serverRoute(WORLD, STORAGE, { page: true, hosted: true }), 'the world hosts the grid: online').toBe('online');
  expect(serverRoute(WORLD, STORAGE, { page: true, hosted: false }), 'the world hosts Driftwood alone: solo').toBe('standalone');
  expect(serverRoute(undefined, STORAGE, { page: true, hosted: true }), 'preview and sharddev').toBe('standalone');
  expect(serverRoute(WORLD, null), 'no storage, no device id to seat').toBe('standalone');
  expect([earlyStandalone(WORLD), earlyStandalone(undefined)]).toEqual([false, true]);
});

// opus-brass3 (Jake 2026-11-12, 17:20 Cancun, Brasscap's Developer-only card: "it kicked me out to the main screen"): the world opens only
// grid cells, so a one-shard page of a shard the grid doesn't place joined it, the door seated the device in Driftwood, and the page left
// for the title. That page plays solo; a placed shard's page and every grid page still join the world.
test('a one-shard page of a shard the grid does not place plays solo on a build with a world', () => {
  expect(serverRoute(WORLD, STORAGE, { page: false, hosted: true }, false), 'Brasscap: off the grid, solo').toBe('standalone');
  expect(serverRoute(WORLD, STORAGE, { page: false, hosted: true }, true), 'a grid shard\'s one-shard page joins').toBe('online');
  expect(serverRoute(WORLD, STORAGE, { page: true, hosted: true }, false), 'a grid page is never asked').toBe('online');
  expect([earlyStandalone(WORLD, false), earlyStandalone(WORLD, true)], 'the early server starts for the solo page only').toEqual([true, false]);
  expect([shardCell('blender-template'), shardCell('driftwood-isle')?.instance], 'the pinned catalogue: Brasscap off the grid, Driftwood on it').toEqual([undefined, 'driftwood-isle']);
  const source = readFileSync('src/client/game/shardfile/clientWorker.ts', 'utf8');
  expect(source).toMatch(/earlyStandalone\([^\n]*, !options\.lone \|\| shardCell\(options\.slug\) !== undefined\)/u);
});

// opus-route2 (QA row 28, Jake 2026-11-12): prod's world opens Driftwood alone (`/health` table {"driftwood-isle":0}), so a one-shard
// page of any other grid shard joined it, the door seated the device in Driftwood, and the page bounced. The door's world word now
// names the shards it opens, and a one-shard page joins only a world that names its own; no word keeps the catalogue's answer.
test('a one-shard page of a grid shard the world does not open plays in-page; one it opens joins; no word keeps today\'s route', () => {
  const driftwoodOnly = { cells: 1, shards: ['driftwood-isle'] }, grid = { cells: 2, shards: ['driftwood-isle', 'nalati-grasslands'] };
  const route = (word: unknown, slug: string): string => serverRoute(WORLD, STORAGE, { page: false, hosted: hostsGrid(word) }, opensShard(word, slug, shardCell(slug) !== undefined));
  expect(route(driftwoodOnly, 'nalati-grasslands'), 'prod today: Nalati is not open, in-page').toBe('standalone');
  expect(route(driftwoodOnly, 'driftwood-isle'), 'Driftwood is open: online').toBe('online');
  expect(route(grid, 'nalati-grasslands'), 'a world that opens Nalati: online').toBe('online');
  expect(route({ cells: 1 }, 'nalati-grasslands'), 'an older door with no list: the catalogue\'s answer').toBe('online');
  expect(route(null, 'nalati-grasslands'), 'no answer (unreachable, stalled): the catalogue\'s answer').toBe('online');
  expect(route(grid, 'blender-template'), 'off the grid: in-page whatever the word, its early server already runs').toBe('standalone');
  expect([opensShard({ cells: 1, shards: 'driftwood-isle' }, 'driftwood-isle', true), opensShard({ cells: 1, shards: [1] }, '1', true)], 'nonsense is no word').toEqual([true, true]);
  const source = readFileSync('src/client/game/shardfile/clientWorker.ts', 'utf8');
  expect(source, 'a one-shard page of a placed shard asks the door\'s word').toMatch(/const catalogued = ports\.grid === null && shardCell\(slug\) !== undefined, asks = catalogued && world !== undefined && page !== null;/u);
  expect(source).toMatch(/opensShard\(await \(asks \? [^\n]*worldWord\(world\)[^\n]*, slug, catalogued\)/u);
});

test('a world hosts the grid when the door\'s world word counts more than the home cell', () => {
  expect(hostsGrid({ cells: 1 }), 'WORLD_CELLS unset: Driftwood alone').toBe(false);
  expect(hostsGrid({ cells: 25 }), 'WORLD_CELLS=grid').toBe(true);
  expect([hostsGrid({ cells: '2' }), hostsGrid(null), hostsGrid('nope'), hostsGrid({ table: { a: 0, b: 1 } })], 'nonsense, or a /health answer').toEqual([false, false, false, false]);
});

test('an online build\'s grid page never calls bootStandalone once the world hosts the grid: the worker client asks the route', () => {
  const source = readFileSync('src/client/game/shardfile/clientWorker.ts', 'utf8');
  const gate = source.split('\n').find(line => line.includes('const shell = await ('));
  expect(gate).toMatch(/serverRoute\(world, page, \{ page: ports\.grid !== null, hosted \}, placed\) === 'online' \? online\(world, page\) : standalone\(\)/u);
  expect(source, 'whether the world hosts the grid is asked of the door').toMatch(/worldHostsGrid\(world, hostsGrid\)/u);
  expect(source).toMatch(/if \(!earlyStandalone\(/u);
  expect(source.match(/bootStandalone\(/gu), 'one definition, the early boot and the route\'s standalone branch').toHaveLength(3);
});

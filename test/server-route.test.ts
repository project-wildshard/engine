import { expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The rule is read where the page applies it.
import { readFileSync } from 'node:fs';
import { hostsGrid, serverRoute, serverStepLabel } from '../src/client/game/shardfile/serverRoute';
import { shardCell } from '../src/client/game/grid/oneWayIn';

// GO4 (QA row 13, "let's make it all the same"): an online build's grid page plays on the world, like a one-shard page.
const WORLD = { release: 'https://packs.example/releases/staging.json', key: 'ab' };
const source = (): string => readFileSync('src/client/game/shardfile/clientWorker.ts', 'utf8');

test('only explicit preview and Explore stamps can start the standalone server', () => {
  expect(serverRoute(WORLD, undefined)).toBe('online');
  expect(serverRoute(WORLD, true)).toBe('online');
  expect(serverRoute(undefined, true)).toBe('standalone');
  expect(serverRoute(undefined, undefined, true)).toBe('standalone');
  expect(serverRoute(WORLD, undefined, true)).toBe('online');
  expect(serverRoute(undefined, undefined, 'true')).toBe('missing');
  expect(serverRoute(undefined, undefined)).toBe('missing');
  expect(serverRoute(undefined, 'true')).toBe('missing');
});

test('the world word never reaches the rule: unreachable, no word, grid not hosted, placed false all go online', () => {
  // The words the page used to route on (null when unreachable or offline, an older door's count, prod's one cell, a world that
  // opens the grid but not Thin Ice): the rule takes none of them, so each such page goes online on a world build.
  for (const why of ['unreachable', 'offline', 'no word', 'grid not hosted', 'placed false']) expect(serverRoute(WORLD, undefined), why).toBe('online');
  expect([shardCell('open-plot-thin-ice'), shardCell('driftwood-isle')?.instance], 'the pinned catalogue: Thin Ice off the grid (J305), Driftwood on it').toEqual([undefined, 'driftwood-isle']);
});

test('a world hosts the grid when the door\'s world word counts more than the home cell', () => {
  expect(hostsGrid({ cells: 1 }), 'WORLD_CELLS unset: Driftwood alone').toBe(false);
  expect(hostsGrid({ cells: 25 }), 'WORLD_CELLS=grid').toBe(true);
  expect([hostsGrid({ cells: '2' }), hostsGrid(null), hostsGrid('nope'), hostsGrid({ table: { a: 0, b: 1 } })], 'nonsense, or a /health answer').toEqual([false, false, false, false]);
});

test('the worker client asks only the route: no world word, world check or catalogue picks its server', () => {
  const text = source(), gate = text.split('\n').find(line => line.includes('const shell = await ('));
  expect(gate).toContain("world !== undefined && route === 'online'");
  expect(text.match(/pageServerRoute\(\) !== 'standalone'/gu)).toHaveLength(2);
  expect(text).toContain("if (route === 'missing') throw new Error");
  for (const gone of ['worldHostsGrid', 'worldWord', 'opensShard', 'server:opens-shard', 'shardCell(']) expect(text, `${gone} no longer picks a server`).not.toContain(gone);
  expect(text.match(/bootStandalone\(/gu), 'one definition, the early boot and the route\'s standalone branch').toHaveLength(3);
});

test('a grid page whose world hosts one cell re-enters as that cell\'s one-shard online page, never the solo grid', () => {
  const text = source();
  // the check (a word in time, the device's kept answer, else the grid: J300) picks the page, then the boot stops for the navigation
  expect(text).toMatch(/!gotoHosted\(\) && !await bootTask\('server:grid-hosted', \(\) => worldHosted\(world\)\)\) \{\n[^\n]*\n\s+if \(scope\.disposed\) throw [^\n]*\n\s+reshard\(bootedCell\);/u);
  expect(readFileSync('src/client/game/session/finish.ts', 'utf8')).toContain('reshard: instance => { reenterShard(instance); }');
  const entry = readFileSync('src/client/game/grid/pageEntry.ts', 'utf8'), body = entry.slice(entry.indexOf('export function reenterShard'));
  expect(body.slice(0, body.indexOf('\n}\n')), 'a one-shard page: no grid intent').not.toContain('pageGridIntents');
});

test('the server step labels the page route', () => {
  try {
    vi.stubGlobal('__WS_WORLD__', WORLD);
    expect(serverStepLabel()).toBe('Joining the world');
    vi.stubGlobal('__WS_WORLD__', undefined);
    vi.stubGlobal('__WS_PREVIEW__', undefined);
    expect(serverStepLabel()).toBe('Game server');
    vi.stubGlobal('__WS_PREVIEW__', true);
    expect(serverStepLabel()).toBe('Starting the in-page server');
  } finally { vi.unstubAllGlobals(); }
  expect(source()).toContain('countedWait(serverStepLabel(),');
  expect(readFileSync('src/client/game/boot/loadingPaths.ts', 'utf8')).toContain("step('server', serverStepLabel())");
});

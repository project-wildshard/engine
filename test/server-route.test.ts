import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The rule is read where the page applies it.
import { readFileSync } from 'node:fs';
import { earlyStandalone, hostsGrid, serverRoute } from '../src/client/game/shardfile/serverRoute';
import { shardCell } from '../src/client/game/grid/oneWayIn';

// GO4 (QA row 13, "let's make it all the same"): an online build's grid page plays on the world, like a one-shard page.
const WORLD = { release: 'https://packs.example/releases/staging.json', key: 'ab' };
const source = (): string => readFileSync('src/client/game/shardfile/clientWorker.ts', 'utf8');

// OFFLINE OF2 (J298, Jake 2026-11-12 ~21:35 Cancún: "staging and prod should never try to play offline versions. They should play the
// online version only"): the route reads only the build's world stamp. Whatever the world says, or fails to say, a world build's page
// goes online; only a build with no world (preview, sharddev) runs the in-page server.
test('a build with a world sends every page online; only a build with no world plays solo', () => {
  expect(serverRoute(WORLD), 'a world build: online').toBe('online');
  expect(serverRoute(undefined), 'preview and sharddev: solo').toBe('standalone');
  expect([earlyStandalone(WORLD), earlyStandalone(undefined)], 'the early in-page server starts only with no world').toEqual([false, true]);
  // The inputs that used to pick the solo route (ba88ac9a, c67ffa8f, GO4's gate) are gone from the rule: none of them reaches it.
  expect(serverRoute.length, 'the world stamp is the only input').toBe(1);
  expect(earlyStandalone.length).toBe(1);
});

test('the world word never reaches the rule: unreachable, no word, grid not hosted, placed false all go online', () => {
  // The words the page used to route on (null when unreachable or offline, an older door's count, prod's one cell, a world that
  // opens the grid but not Thin Ice): the rule takes none of them, so each such page goes online on a world build.
  expect(serverRoute.length, 'the world stamp is the only input').toBe(1);
  for (const why of ['unreachable', 'offline', 'no word', 'grid not hosted', 'placed false']) expect(serverRoute(WORLD), why).toBe('online');
  expect([shardCell('open-plot-thin-ice'), shardCell('driftwood-isle')?.instance], 'the pinned catalogue: Thin Ice off the grid (J305), Driftwood on it').toEqual([undefined, 'driftwood-isle']);
});

test('a world hosts the grid when the door\'s world word counts more than the home cell', () => {
  expect(hostsGrid({ cells: 1 }), 'WORLD_CELLS unset: Driftwood alone').toBe(false);
  expect(hostsGrid({ cells: 25 }), 'WORLD_CELLS=grid').toBe(true);
  expect([hostsGrid({ cells: '2' }), hostsGrid(null), hostsGrid('nope'), hostsGrid({ table: { a: 0, b: 1 } })], 'nonsense, or a /health answer').toEqual([false, false, false, false]);
});

test('the worker client asks only the route: no world word, world check or catalogue picks its server', () => {
  const text = source(), gate = text.split('\n').find(line => line.includes('const shell = await ('));
  expect(gate).toMatch(/serverRoute\(world\) === 'online' \? online\(world, page \?\? pageOnlyStorage\(\)\) : standalone\(\)/u);
  expect(text, 'the early in-page server asks the world stamp only').toMatch(/if \(!earlyStandalone\(\(globalThis as \{ __WS_WORLD__\?: BuildWorld \}\)\.__WS_WORLD__\)\) return;/u);
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

import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The rule is read where the page applies it.
import { readFileSync } from 'node:fs';
import { earlyStandalone, hostsGrid, serverRoute } from '../src/client/game/shardfile/serverRoute';

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

test('a world hosts the grid when the door\'s world word counts more than the home cell', () => {
  expect(hostsGrid({ cells: 1 }), 'WORLD_CELLS unset: Driftwood alone').toBe(false);
  expect(hostsGrid({ cells: 25 }), 'WORLD_CELLS=grid').toBe(true);
  expect([hostsGrid({ cells: '2' }), hostsGrid(null), hostsGrid('nope'), hostsGrid({ table: { a: 0, b: 1 } })], 'nonsense, or a /health answer').toEqual([false, false, false, false]);
});

test('an online build\'s grid page never calls bootStandalone once the world hosts the grid: the worker client asks the route', () => {
  const source = readFileSync('src/client/game/shardfile/clientWorker.ts', 'utf8');
  const gate = source.split('\n').find(line => line.includes('const shell = await ('));
  expect(gate).toMatch(/serverRoute\(world, page, \{ page: ports\.grid !== null, hosted \}\) === 'online' \? online\(world, page\) : standalone\(\)/u);
  expect(source, 'whether the world hosts the grid is asked of the door').toMatch(/worldHostsGrid\(world, hostsGrid\)/u);
  expect(source).toMatch(/if \(!earlyStandalone\(/u);
  expect(source.match(/bootStandalone\(/gu), 'one definition, the early boot and the route\'s standalone branch').toHaveLength(3);
});

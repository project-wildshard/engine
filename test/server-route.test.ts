import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The rule is read where the page applies it.
import { readFileSync } from 'node:fs';
import { earlyStandalone, serverRoute } from '../src/client/game/shardfile/serverRoute';

// GO4 (QA row 13, "let's make it all the same"): an online build's grid page plays on the world, like a one-shard page.
const WORLD = { release: 'https://packs.example/releases/staging.json', key: 'ab' }, STORAGE = {};

test('an online build puts every page in the world; only a build with no world runs the in-page server', () => {
  expect(serverRoute(WORLD, STORAGE), 'a grid page or a one-shard page: the same').toBe('online');
  expect(serverRoute(undefined, STORAGE), 'preview and sharddev').toBe('standalone');
  expect(serverRoute(WORLD, null), 'no storage, no device id to seat').toBe('standalone');
  expect([earlyStandalone(WORLD), earlyStandalone(undefined)]).toEqual([false, true]);
});

test('an online build\'s grid page never calls bootStandalone: the worker client asks the route, with no grid exception', () => {
  const source = readFileSync('src/client/game/shardfile/clientWorker.ts', 'utf8');
  const gate = source.split('\n').find(line => line.includes('const shell = await ('));
  expect(gate).toMatch(/serverRoute\(world, page\) === 'online' \? online\(world, page\) : standalone\(\)/u);
  expect(gate, 'the old gate kept grid pages solo').not.toMatch(/ports\.grid === null/u);
  expect(source).toMatch(/if \(!earlyStandalone\(/u);
  expect(source.match(/bootStandalone\(/gu), 'one definition, the early boot and the route\'s standalone branch').toHaveLength(3);
});

// @vitest-environment node
// Fix preview PV8 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md): a zoneless page's in-page server reads a
// zone's server pack from the cook, at the zone table's key (staging's build and cook), never from the page build's server book, which
// holds the road's part only (app-build/zoneless.mjs).
import {expect, test} from 'vitest';
import type {Rapier} from '@wildshard/engine/physics/rapier';
import {cookedServerSource, readServerFolder} from '../src/server/host/standalone/serverFolder';
import {cookedIndexKey} from '../src/shared/game/shardfile/cookedPackPaths';

const STORE = 'https://store.example/', SLUG = 'driftwood-isle', ref = {slug: SLUG, shardVersion: '0.3.1', cookVersion: '1.0.0', cookHash: 'c'.repeat(64)};
const table = {version: 1, from: {channel: 'staging', serial: 159, engineBuild: 'a'.repeat(40)}, cookVersion: ref.cookVersion, cookHash: ref.cookHash, origin: STORE,
  zones: [{slug: SLUG, shardVersion: ref.shardVersion, index: cookedIndexKey(ref)}]};
const common = (name: string): string => `shards/${SLUG}/${ref.shardVersion}/common/${name}`;
const PACK = '/assets/spawn/server-driftwood-isle-0123456789abcdef.json', PART = '/assets/spawn/server/fedcba9876543210.pack.br';
const INDEX = {version: 2, ...ref, hash: 'e'.repeat(64), build: 'staging-build', header: `shardfiles/${SLUG}/shard.json`, manifests: [],
  objects: {[PACK.slice(1)]: common('pack'), [PART.slice(1)]: common('part')}, serverPack: {index: PACK}};
const served = new Map<string, unknown>([[cookedIndexKey(ref), INDEX], [common('pack'), {url: PART, bytes: 1, hash: 'a'.repeat(64), wireBytes: 1, files: [['shard.json', 0, 1]]}]]);

test('a zone the page\'s table names reads its server pack from the cook at the table\'s key, not the page build\'s book', async () => {
  const versioned = cookedServerSource(JSON.stringify(table));
  expect(versioned(`_${SLUG}`)).toEqual({ref, origin: STORE});
  expect(versioned('pine-hollow')).toBeUndefined();
  expect(cookedServerSource(null)(SLUG)).toBeUndefined();
  const asked: string[] = [];
  await readServerFolder(`https://page.example/shardfiles/${SLUG}/`, () => 'page-build', url => {
    asked.push(url.href);
    const body = served.get(url.pathname.slice(1));
    if (body === undefined) return Promise.resolve(new Uint8Array([123]));
    return Promise.resolve(new TextEncoder().encode(JSON.stringify(body)));
  }, {} as Rapier, undefined, undefined, undefined, false, undefined, versioned(SLUG)).catch(() => undefined);
  // the index at the table's key, then the pack and its part at the object keys it names: all in the store, no book
  expect(asked[0]?.startsWith(`${STORE}${cookedIndexKey(ref)}`)).toBe(true);
  expect(asked.slice(1, 3)).toEqual([`${STORE}${common('pack')}`, `${STORE}${common('part')}`]);
  expect(asked.filter(url => !url.startsWith(STORE) || url.includes('server-page-build'))).toEqual([]);
});

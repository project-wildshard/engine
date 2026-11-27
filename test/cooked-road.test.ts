// @vitest-environment node
// Fix preview PV6 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md): the grid road's bake reads each zone's files
// from the cook, through its index, instead of an installed pin, and gets the same bytes. A tiny made-up `out/` (J507) is laid out as
// the cooked bucket (`cooked-fixture.mjs`); every file the pinned bake would read comes back byte for byte through the cooked reader.
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is a real folder in owned scratch under tmp/.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine the scratch root to this checkout.
import {join, resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Lay out a compressed cooked part like the real file store.
import {brotliCompressSync} from 'node:zlib';
import {contentHash} from '../src/shared/game/shardfile/contentHash.ts';
import {afterEach, expect, test} from 'vitest';
import {cookedFixture} from '../src/scripts/cooked-fixture.mjs';
import {cookedReader} from '../src/scripts/cooked-reads.mjs';
import {readZoneTable} from '../src/shared/game/grid/zoneTable.ts';

const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, {recursive: true, force: true}); });
function root(): string {
  mkdirSync(resolve('tmp'), {recursive: true});
  const dir = mkdtempSync(join(resolve('tmp'), 'cooked-road-')); scratch.push(dir);
  const files: Record<string, string> = {'shard.json': '{"name":"isle"}', 'sections/world-edge.json': '[1,2,3]', 'blobs/image/ab.jpg': 'jpg', 'mounts/x/y.bin': 'bin'};
  for (const [slug, body] of [['isle-one', 'a'], ['isle-two', 'b']] as const) for (const [path, text] of Object.entries(files)) {
    mkdirSync(resolve(dir, 'out', slug, path, '..'), {recursive: true});
    writeFileSync(join(dir, 'out', slug, path), `${text}${body}`);
  }
  return dir;
}

test('every zone file reads the same bytes from the cook as from the pin, and nothing else is served', async () => {
  const dir = root(), {table, origin} = cookedFixture(dir, join(dir, 'cooked'));
  expect(readZoneTable(JSON.parse(JSON.stringify(table)))).toEqual(table);
  const reader = await cookedReader(table, {origin});
  expect({zones: reader.zones, objects: reader.objects}).toEqual({zones: 2, objects: 8});
  expect(reader.header('_isle-two')).toBe('/shardfiles/isle-two/shard.json');
  for (const slug of ['isle-one', 'isle-two']) for (const path of ['shard.json', 'sections/world-edge.json', 'blobs/image/ab.jpg', 'mounts/x/y.bin']) {
    const cooked = new Uint8Array(await (await reader.fetchFile(`/shardfiles/${slug}/${path}?v=1`)).arrayBuffer());
    expect(Buffer.from(cooked).equals(readFileSync(join(dir, 'out', slug, path))), `${slug}/${path}`).toBe(true);
  }
  expect((await reader.fetchFile('/shardfiles/isle-one/missing.json')).status).toBe(404);
  expect((await reader.fetchFile('/assets/grid-road/x.bin')).status).toBe(404);
});

test('a zone whose index is missing or is another cook\'s refuses the bake by name', async () => {
  const dir = root(), {table, origin} = cookedFixture(dir, join(dir, 'cooked'), {slugs: ['isle-one']});
  const [row] = table.zones;
  if (row === undefined) throw new Error('no zone');
  await expect(cookedReader({...table, zones: [{...row, slug: 'isle-two', index: row.index.replace('isle-one', 'isle-two')}]}, {origin})).rejects.toThrow(/No cooked index for isle-two/u);
  const index = join(dir, 'cooked', row.index);
  writeFileSync(index, JSON.stringify({...JSON.parse(readFileSync(index, 'utf8')), cookVersion: '2.0.0'}));
  await expect(cookedReader(table, {origin})).rejects.toThrow();
});

test('a packed road input is recovered from its part and verified before use', async () => {
  const dir = root(), bucket = join(dir, 'cooked'), {table, origin} = cookedFixture(dir, bucket, {slugs: ['isle-one']});
  const [row] = table.zones;
  if (row === undefined) throw new Error('no zone');
  const file = join(bucket, row.index), index = JSON.parse(readFileSync(file, 'utf8')) as {objects: Record<string, string>};
  const logical = 'shardfiles/isle-one/sections/world-edge.json', part = 'assets/spawn/server/cooked.pack.br';
  const originalKey = index.objects[logical];
  if (originalKey === undefined) throw new Error('no edge');
  const bytes = readFileSync(join(bucket, originalKey)), prefix = Buffer.from('padding');
  const key = `shards/isle-one/${row.shardVersion}/common/cooked.pack.br`;
  writeFileSync(join(bucket, key), brotliCompressSync(Buffer.concat([prefix, bytes])));
  delete index.objects[logical];
  index.objects[part] = key;
  const address = {part, offset: prefix.length, bytes: bytes.length, hash: await contentHash(bytes)};
  writeFileSync(file, JSON.stringify({...index, members: {[logical]: address}}));
  const reader = await cookedReader(table, {origin});
  expect(await (await reader.fetchFile(`/${logical}?v=1`)).text()).toBe(bytes.toString());
  writeFileSync(join(bucket, key), brotliCompressSync(Buffer.concat([prefix, Buffer.alloc(bytes.length)])));
  await expect(reader.fetchFile(`/${logical}`)).rejects.toThrow('Cooked member digest differs');
});

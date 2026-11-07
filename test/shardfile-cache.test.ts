// oxlint-disable-next-line import/no-nodejs-modules -- Every write is confined to an owned fixture under ./tmp.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { dirname, join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { borrowShardfileEntry, pruneShardfileCache, reuseOrBuild, shardfileKey, treeHashes } from '../scripts/shardfile-cache.mjs';
// oxlint-disable-next-line import/no-nodejs-modules -- Pin this test's actual live reader, not a fictitious owner.
import { pid } from 'node:process';

const owned: string[] = [];
afterEach(() => { for (const dir of owned.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(files: Record<string, string>): string {
  mkdirSync(resolve('tmp'), { recursive: true });
  const root = mkdtempSync(join(resolve('tmp'), 'shardfile-cache-test-'));
  owned.push(root);
  write(root, files);
  return root;
}
function write(root: string, files: Record<string, string>): void {
  for (const [path, body] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); }
}
const built = ['alpha', 'beta'];
const keys = (root: string): { alpha: string; beta: string } => {
  const files = treeHashes(root);
  return { alpha: shardfileKey(files, 'alpha', built, []), beta: shardfileKey(files, 'beta', built, []) };
};

it('re-keys only the shard whose own files change, and every shard on a shared change', () => {
  const root = fixture({ 'src/engine/a.ts': '1', 'src/shards/alpha/x.ts': '1', 'src/shards/beta/y.ts': '1', 'public/assets/beta/m.bin': '1',
    'public/assets/models/shared.glb': '1', 'docs/n.md': '1', 'public/shardfiles/alpha/shard.json': '{}' });
  const before = keys(root);
  write(root, { 'src/shards/beta/y.ts': '2' });
  const afterBeta = keys(root);
  expect(afterBeta.alpha).toBe(before.alpha);
  expect(afterBeta.beta).not.toBe(before.beta);
  write(root, { 'public/assets/beta/m.bin': '2', 'docs/n.md': '2', 'public/shardfiles/alpha/shard.json': '{"x":1}' });
  const afterAssets = keys(root);
  expect(afterAssets.alpha).toBe(before.alpha);
  expect(afterAssets.beta).not.toBe(afterBeta.beta);
  write(root, { 'public/assets/models/shared.glb': '2' });
  const afterShared = keys(root);
  expect(afterShared.alpha).not.toBe(before.alpha);
  write(root, { 'src/engine/a.ts': '2' });
  expect(keys(root).alpha).not.toBe(afterShared.alpha);
});

it('reuses a published product and rebuilds on a new key', async () => {
  const root = fixture({});
  const cacheRoot = join(root, 'cache'), destination = join(root, 'out');
  let builds = 0;
  const build = (body: string) => (out: string): Promise<void> => { builds++; write(out, { 'shard.json': body }); return Promise.resolve(); };
  expect(await reuseOrBuild({ slug: 'alpha', key: 'a'.repeat(64), destination, cacheRoot, build: build('one') })).toBe('built');
  expect(await reuseOrBuild({ slug: 'alpha', key: 'a'.repeat(64), destination, cacheRoot, build: build('two') })).toBe('slot');
  rmSync(destination, { recursive: true });
  expect(await reuseOrBuild({ slug: 'alpha', key: 'a'.repeat(64), destination, cacheRoot, build: build('two') })).toBe('cache');
  expect(readFileSync(join(destination, 'shard.json'), 'utf8')).toBe('one');
  expect(await reuseOrBuild({ slug: 'alpha', key: 'b'.repeat(64), destination, cacheRoot, build: build('three') })).toBe('built');
  expect(readFileSync(join(destination, 'shard.json'), 'utf8')).toBe('three');
  // A full build always builds and serves its own bytes.
  expect(await reuseOrBuild({ slug: 'alpha', key: 'b'.repeat(64), destination, cacheRoot, fresh: true, build: build('four') })).toBe('built');
  expect(readFileSync(join(destination, 'shard.json'), 'utf8')).toBe('four');
  expect(builds).toBe(3);
  expect(existsSync(join(cacheRoot, 'alpha', 'a'.repeat(64), 'shard.json'))).toBe(true);
});

it('publishes a cold build under its completed input receipt key', async () => {
  const root = fixture({}), cacheRoot = join(root,'cache'), destination = join(root,'out'), complete = 'c'.repeat(64);
  expect(await reuseOrBuild({slug:'alpha',key:'0'.repeat(64),destination,cacheRoot,build:out=>{
    write(out,{'shard.json':'compiled'}); return Promise.resolve(complete);
  }})).toBe('built');
  expect(existsSync(join(cacheRoot,'alpha',complete,'shard.json'))).toBe(true);
  expect(await reuseOrBuild({slug:'alpha',key:complete,destination,cacheRoot,build:():Promise<void>=>Promise.reject(new Error('must reuse'))})).toBe('slot');
});

it('prunes by idle age and global LRU while live clones, producers and linked roots survive', async () => {
  const root = fixture({}), cache = join(root, 'cache');
  const paths = ['a', 'b', 'c', 'd'].map((letter, index) => {
    const path = join(cache, index === 0 ? 'alpha' : 'beta', letter.repeat(64));
    write(path, { 'shard.json': 'fixture', '.build-key': letter.repeat(64), 'data.bin': 'x'.repeat(32768) });
    const at = new Date(Date.now() - ([30, 3, 2, 1][index] ?? 1) * 3_600_000);
    utimesSync(path, at, at);
    return path;
  });
  const old = paths[0], reader = paths[1], locked = paths[2], recent = paths[3];
  if (old === undefined || reader === undefined || locked === undefined || recent === undefined) throw new Error('Missing fixture');
  write(`${reader}.readers`, { [`${pid}-${'a'.repeat(24)}`]: '' });
  mkdirSync(`${locked}.lock`);
  const dry = pruneShardfileCache(cache, { dryRun: true, capBytes: 0 });
  expect(dry.deleted).toBe(2);
  expect(paths.every(path => existsSync(path))).toBe(true);
  const age = pruneShardfileCache(cache);
  expect(age.deleted).toBe(1); expect(existsSync(old)).toBe(false);
  const capped = pruneShardfileCache(cache, { capBytes: 0 });
  expect(capped.deleted).toBe(1); expect(capped.locked).toBe(2);
  expect(existsSync(reader)).toBe(true); expect(existsSync(locked)).toBe(true); expect(existsSync(recent)).toBe(false);
  symlinkSync(cache, join(root, 'link'));
  expect(pruneShardfileCache(join(root, 'link'), { capBytes: 0 }).deleted).toBe(0);
  rmSync(`${reader}.readers`, { recursive: true }); rmSync(`${locked}.lock`, { recursive: true });
  expect(pruneShardfileCache(cache, { capBytes: 0 }).deleted).toBe(2);
  expect(existsSync(reader)).toBe(false); expect(existsSync(locked)).toBe(false);
  // The same reader pin is held through a real asynchronous cold producer.
  const key = 'e'.repeat(64);
  await reuseOrBuild({ slug: 'alpha', key, destination: join(root, 'output'), cacheRoot: cache, build: async out => {
    write(out, { 'shard.json': 'fresh' });
    const prior = new Date(Date.now() - 48 * 3_600_000); utimesSync(out, prior, prior);
    await Promise.resolve();
    pruneShardfileCache(cache, { capBytes: 0 });
    expect(existsSync(out)).toBe(true);
    expect(existsSync(join(cache, 'alpha', `${key}.readers`))).toBe(true);
  } });
  expect(readFileSync(join(root, 'output', 'shard.json'), 'utf8')).toBe('fresh');
  expect(existsSync(join(cache, 'alpha', `${key}.readers`))).toBe(false);
});

it('counts receipt histories in the same budget and pins returned-path consumers until exit', () => {
  const root = fixture({}), cache = join(root, 'cache'), directory = join(cache, '.inputs-v2', 'alpha', 'a'.repeat(64));
  write(directory, { [`${'b'.repeat(64)}.json`]: 'receipt' });
  const release = borrowShardfileEntry(directory);
  expect(pruneShardfileCache(cache, { capBytes: 0 }).locked).toBe(1);
  release();
  expect(pruneShardfileCache(cache, { capBytes: 0 }).deleted).toBe(1);
  const product = join(cache, 'alpha', 'c'.repeat(64));
  write(product, { 'shard.json': 'product' });
  const finish = borrowShardfileEntry(product, true);
  borrowShardfileEntry(product, true); // Repeated returned paths share one process pin.
  expect(pruneShardfileCache(cache, { capBytes: 0 }).locked).toBe(1);
  finish();
  expect(pruneShardfileCache(cache, { capBytes: 0 }).deleted).toBe(1);
});

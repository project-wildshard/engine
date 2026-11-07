// oxlint-disable-next-line import/no-nodejs-modules -- Each control owns its optional snapshot directory.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture scratch stays under the repository's private tmp root.
import { resolve } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { runNativeCacheSnapshot, type NativeCacheSnapshotIdentity } from './fixtures/native-cache-snapshot';
import { runSnapshot } from './fixtures/runSnapshot';

const directories: string[] = [], identity: NativeCacheSnapshotIdentity = { node: 'v24.0.0', platform: 'linux', arch: 'x64', compiler: 'a'.repeat(64) };
const value = () => ({ files: new Map([['index.json', Uint8Array.of(1, 2, 3)]]), constructions: new Map([['admission-program', 1]]) });
const writer = () => {
  mkdirSync('tmp', { recursive: true }); const directory = mkdtempSync(resolve('tmp', 'native-cache-snapshot-'));
  directories.push(directory); vi.stubEnv('WS_TEST_PRODUCTS_SHA', 'a'.repeat(40));
  vi.stubEnv('WS_FIXTURE_SNAPSHOT_WRITE', directory); return directory;
};
const reader = (directory: string) => { vi.stubEnv('WS_FIXTURE_SNAPSHOT_WRITE', ''); vi.stubEnv('WS_FIXTURE_SNAPSHOTS', directory); };
afterEach(() => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

test('a matching native context restores the complete corpus without computing another source', async () => {
  const directory = writer(), written = await runNativeCacheSnapshot('cache', identity, () => Promise.resolve(value()));
  reader(directory); const compute = vi.fn((): Promise<ReturnType<typeof value>> => Promise.reject(new Error('Unexpected native reconstruction')));
  const restored = await runNativeCacheSnapshot('cache', identity, compute);
  expect(compute).not.toHaveBeenCalled(); expect(restored).toStrictEqual(written);
  expect(restored.files.get('index.json')?.buffer).not.toBe(written.files.get('index.json')?.buffer);
});

test.each(['node', 'platform', 'arch', 'compiler'] as const)('a foreign %s context never admits its cache files', async key => {
  const directory = writer(); await runNativeCacheSnapshot('cache', identity, () => Promise.resolve(value()));
  reader(directory); const fresh = { ...value(), files: new Map([['current', Uint8Array.of(9)]]) }, compute = vi.fn(() => Promise.resolve(fresh));
  expect(await runNativeCacheSnapshot('cache', { ...identity, [key]: 'foreign' }, compute)).toBe(fresh);
  expect(compute).toHaveBeenCalledOnce();
});

test('a legacy untagged corpus computes in this context instead of hydrating old keys', async () => {
  const directory = writer(); await runSnapshot('cache', () => Promise.resolve(value())); reader(directory);
  const fresh = value(), compute = vi.fn(() => Promise.resolve(fresh));
  expect(await runNativeCacheSnapshot('cache', identity, compute)).toBe(fresh); expect(compute).toHaveBeenCalledOnce();
});

test('foreign source authority and native failures still refuse without retry', async () => {
  const directory = writer(); await runNativeCacheSnapshot('cache', identity, () => Promise.resolve(value())); reader(directory);
  const compute = vi.fn(() => Promise.reject(new Error('Native source refused')));
  vi.stubEnv('WS_TEST_PRODUCTS_SHA', 'b'.repeat(40));
  await expect(runNativeCacheSnapshot('cache', identity, compute)).rejects.toThrow('belongs to another fixture or commit');
  expect(compute).not.toHaveBeenCalled(); vi.stubEnv('WS_TEST_PRODUCTS_SHA', 'a'.repeat(40));
  await expect(runNativeCacheSnapshot('cache', { ...identity, compiler: 'foreign' }, compute)).rejects.toThrow('Native source refused');
  expect(compute).toHaveBeenCalledOnce();
});

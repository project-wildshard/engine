// SHARD-COMPAT SP1b3b: the record job records the canary first, holds every other shard on a canary that differs (until
// it is accepted), and keeps each recording as a sidecar the cook takes. The recorder is a stand-in that writes what
// `wildshard prepare` would on the box's renderer.
// oxlint-disable-next-line import/no-nodejs-modules -- The test owns its folders.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Folders under the repository's tmp/.
import {dirname, join, resolve} from 'node:path';
import {afterAll, expect, test} from 'vitest';
import {readTar, writeTar} from '@wildshard/format/tar';
import {readSidecarTar} from '../src/cook/game/cookSidecar';
import {recordCatalogue, recordSidecars, type RecordInput} from '../src/cook/game/recordSidecars';
import {openShardfile} from '../src/cook/game/shardCook';
import {digest, legacyBrasscap, MOVED, PREPARED, prepared} from './fixtures/stale-preparation';

mkdirSync('tmp/record-sidecars', {recursive: true});
const root = mkdtempSync(resolve('tmp/record-sidecars/run-'));
afterAll(() => { rmSync(root, {recursive: true, force: true}); });

const brasscap = readTar(legacyBrasscap());
const input = (slug: string, fenced: boolean, renderer = PREPARED): RecordInput => {
  const tarball = writeTar(prepared(brasscap, renderer, fenced));
  return {slug, hash: digest(tarball), tarball};
};
/** A recorder on MOVED: rewrites the folder's preparation as `wildshard prepare` would. */
const recorder = () => (folder: string): Promise<void> => {
  const fenced = JSON.parse(readFileSync(join(folder, 'cook.json'), 'utf8')).fence.length > 0;
  const files = prepared(brasscap, MOVED, fenced);
  for (const [path, bytes] of files) { const file = join(folder, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, bytes); }
  return Promise.resolve();
};
const ports = (name: string, prepare: (folder: string) => Promise<void>, accepted?: ReadonlySet<string>) => {
  const lines: string[] = [];
  return {lines, ports: {renderer: MOVED, sidecars: join(root, name, 'sidecars'), scratch: join(root, name, 'scratch'), prepare, log: (line: string) => { lines.push(line); }, ...(accepted === undefined ? {} : {accepted})}};
};

test('an equal canary opens the job: every stale shard gets a sidecar the cook takes, and a current one none', async () => {
  const canary = input('brasscap-mesa', true), other = input('brasscap-mesa', false), current = input('brasscap-mesa', true, MOVED);
  const {lines, ports: job} = ports('equal', recorder());
  expect((await recordSidecars(canary, [other, current], job)).map(row => row.state)).toEqual(['recorded', 'recorded', 'current']);
  expect(lines).toContain('canary equal: brasscap-mesa');
  for (const shard of [canary, other]) {
    const sidecar = readSidecarTar(readFileSync(join(job.sidecars, shard.hash, `${MOVED}.tar`)));
    expect(openShardfile(shard.tarball, {renderer: MOVED, sidecar}).preparation).toBe('cook');
  }
  expect(existsSync(join(job.sidecars, current.hash))).toBe(false);
  // A second run keeps what it recorded.
  expect((await recordSidecars(canary, [other], job)).map(row => row.state)).toEqual(['kept', 'kept']);
});

test('a canary that differs holds every shard and writes nothing until a person accepts its recording', async () => {
  const canary = input('brasscap-mesa', true), other = input('brasscap-mesa', false);
  // This recorder lists no fence where the author listed one: still a whole preparation, but not the author's.
  const differing = (folder: string): Promise<void> => {
    const files = prepared(brasscap, MOVED, false);
    for (const [path, bytes] of files) { const file = join(folder, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, bytes); }
    return Promise.resolve();
  };
  const recordedHash = digest(prepared(brasscap, MOVED, false).get('cook.json') ?? new Uint8Array());
  const held = ports('differs', differing);
  const rows = await recordSidecars(canary, [other], held.ports);
  expect(rows.map(row => row.state)).toEqual(['held', 'held']);
  expect(held.lines).toContain('canary differs: brasscap-mesa: fence; no other shard records until it is accepted');
  expect(existsSync(held.ports.sidecars)).toBe(false);
  // Accepted by its recorded hash, the job goes on.
  const accepted = ports('accepted', differing, new Set([recordedHash]));
  expect((await recordSidecars(canary, [other], accepted.ports)).map(row => row.state)).toEqual(['recorded', 'recorded']);
});

test('a recorder that fails leaves the shard stale and holds the rest when it is the canary', async () => {
  const canary = input('brasscap-mesa', true), other = input('brasscap-mesa', false);
  const {ports: job} = ports('fails', () => Promise.reject(new Error('headless WebKit did not start')));
  expect(await recordSidecars(canary, [other], job)).toEqual([
    {slug: 'brasscap-mesa', hash: canary.hash, state: 'failed', detail: 'headless WebKit did not start'},
    {slug: 'brasscap-mesa', hash: other.hash, state: 'held', detail: 'canary brasscap-mesa failed'}]);
});

test('over a worker catalogue the named canary records first, each head downloads in its turn, and a kept one never again', async () => {
  const other = input('brasscap-other', false), canary = input('brasscap-mesa', true), byHash = new Map([other, canary].map(row => [row.hash, row.tarball]));
  const downloads: string[] = [];
  const source = {heads: () => Promise.resolve([{slug: other.slug, hash: other.hash, revision: 1}, {slug: canary.slug, hash: canary.hash, revision: 1}]),
    download: (hash: string) => { downloads.push(hash); const bytes = byHash.get(hash); return bytes === undefined ? Promise.reject(new Error('unknown')) : Promise.resolve(bytes); }};
  const {lines, ports: job} = ports('catalogue', recorder());
  expect((await recordCatalogue(source, ['live', 'staging'], 'brasscap-mesa', job)).map(row => `${row.slug} ${row.state}`)).toEqual(['brasscap-mesa recorded', 'brasscap-other recorded']);
  expect(downloads).toEqual([canary.hash, other.hash]);
  expect(lines[0]).toBe('canary equal: brasscap-mesa');
  expect((await recordCatalogue(source, ['live'], 'brasscap-mesa', job)).map(row => row.state)).toEqual(['kept', 'kept']);
  expect(downloads).toHaveLength(2);
  expect(await recordCatalogue(source, ['live'], 'no-such-shard', job)).toEqual([]);
});

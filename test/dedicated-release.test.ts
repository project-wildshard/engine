// oxlint-disable-next-line import/no-nodejs-modules -- A release is signed by a real key.
import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, test } from 'vitest';
import { readReleaseFile, ReleaseWatch } from '../src/server/host/dedicated/releaseFile';
import type { ReleaseFile } from '../src/shared/host/releaseRows';

// J171: the signed release file. A bad signature is refused before a byte of it is believed, and only a newer file moves a server.
const { publicKey, privateKey } = generateKeyPairSync('ed25519'), KEY = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
const release = (serial: number, engineBuild = 'b1'): ReleaseFile => ({ channel: 'production', serial, engineBuild, saveEpoch: 2, shards: [{ slug: 'driftwood-isle', revision: 7 }] });
const signed = (body: string, key = privateKey): string => JSON.stringify({ body, signature: sign(null, Buffer.from(body), key).toString('hex') });

test('a file signed by the key reads back; anything else is refused', () => {
  const text = signed(JSON.stringify(release(3)));
  expect(readReleaseFile(text, KEY)).toEqual(release(3));
  expect(() => readReleaseFile(text.replace(String.raw`"serial\":3`, String.raw`"serial\":9`), KEY)).toThrow(/bad signature/u);
  expect(() => readReleaseFile(signed(JSON.stringify(release(3)), generateKeyPairSync('ed25519').privateKey), KEY)).toThrow(/bad signature/u);
  expect(() => readReleaseFile(signed('{"channel":"live"}'), KEY), 'signed, and still not a release').toThrow();
});

test('a watch moves on a newer release only, once, and a failed look or a failed preload tries again', async () => {
  let next: ReleaseFile | Error = release(5), preload: Error | null = null;
  const changed: number[] = [], failures: unknown[] = [];
  const watch = new ReleaseWatch({ serving: release(5), everyMs: 3_600_000, failed: error => { failures.push(error); },
    read: () => next instanceof Error ? Promise.reject(next) : Promise.resolve(next),
    changed: file => { if (preload !== null) return Promise.reject(preload); changed.push(file.serial); return Promise.resolve(); } });
  await watch.look();
  next = release(4);
  await watch.look();
  expect(changed, 'the same, then an older one: we only fix forward').toEqual([]);
  next = new Error('R2 is away');
  await watch.look();
  expect(failures).toHaveLength(1);
  next = { ...release(9), channel: 'staging' };
  await watch.look();
  expect(failures, 'another channel\'s file').toHaveLength(2);
  next = release(6, 'b2'); preload = new Error('A pack would not read');
  await watch.look();
  expect(changed).toEqual([]);
  expect(failures).toHaveLength(3);
  preload = null;
  await watch.look();
  next = release(7);
  await watch.look();
  expect(changed).toEqual([6]);
  watch.dispose();
});

test('boot pins the installed epoch and configured channel', async () => {
  const { servingRelease } = await import('../src/server/host/dedicated/releaseFile');
  const kept = release(10), older = { ...release(9), saveEpoch: 1 };
  expect(servingRelease('b1', 'production', older, kept)).toEqual(kept);
  expect(servingRelease('b1', 'production', { ...kept, saveEpoch: 1 }, kept)).toEqual(kept);
  expect(servingRelease('b1', 'production', { ...release(11), saveEpoch: 3 }, kept)).toEqual(kept);
  expect(() => servingRelease('b1', 'staging', kept, kept)).toThrow();
  expect(servingRelease('b1', 'production', null, kept)).toEqual(kept);
});

test('an installed bundle with unreadable kept metadata refuses remote fallback', async () => {
  const { servingRelease } = await import('../src/server/host/dedicated/releaseFile');
  expect(() => servingRelease('b1', 'production', release(3), null, true)).toThrow();
});

test('a release missing an open cell cannot begin a grace', async () => {
  const changed: number[] = [], failures: unknown[] = [];
  const watch = new ReleaseWatch({ serving: release(1), cells: ['driftwood-isle', 'nalati-grasslands'], everyMs: 3_600_000,
    read: () => Promise.resolve(release(2)), changed: next => { changed.push(next.serial); return Promise.resolve(); }, failed: error => { failures.push(error); } });
  try { await watch.look(); expect(changed).toEqual([]); expect(failures).toHaveLength(1); }
  finally { watch.dispose(); }
});

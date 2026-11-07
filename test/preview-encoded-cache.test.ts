// oxlint-disable-next-line import/no-nodejs-modules -- Observe actual Brotli and gzip representations of the owned HTTP fixture.
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the live input for the native encoder behavior control.
import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { createEncodedFileCache } from '../scripts/preview-encoded-cache.mjs';

function pendingBytes(): { promise: Promise<Buffer>; finish: (bytes: Buffer) => void } {
  let finish: (bytes: Buffer) => void = () => { throw new Error('Uninitialized byte producer'); };
  const promise = new Promise<Buffer>(resolve => { finish = resolve; });
  return { promise, finish };
}

test('concurrent readers share encoding work; encodings remain independent', async () => {
  const produced: string[] = [], pending = pendingBytes();
  const cache = createEncodedFileCache({ encode: (_file, encoding) => {
    produced.push(encoding); return pending.promise;
  } });
  const first = cache.get('body', 'revision-one', 4, 'br');
  expect(first).toBeDefined();
  expect(cache.get('body', 'revision-one', 4, 'br')).toBe(first);
  const gzip = cache.get('body', 'revision-one', 4, 'gzip');
  expect(gzip).not.toBe(first);
  pending.finish(Buffer.from('wire'));
  await Promise.all([first, gzip]);
  expect(produced).toEqual(['br', 'gzip']);
  expect(await cache.get('body', 'revision-one', 4, 'br')).toEqual(Buffer.from('wire'));
  expect(produced).toHaveLength(2);
});

test('a stale in-flight encode cannot replace the current file revision', async () => {
  const old = pendingBytes(), current = pendingBytes();
  let calls = 0;
  const cache = createEncodedFileCache({ encode: () => (++calls === 1 ? old.promise : current.promise) });
  const first = cache.get('body', 'old', 4, 'br');
  await Promise.resolve();
  const second = cache.get('body', 'new', 4, 'br');
  current.finish(Buffer.from('new'));
  expect(await second).toEqual(Buffer.from('new'));
  old.finish(Buffer.from('old'));
  expect(await first).toEqual(Buffer.from('old'));
  expect(cache.get('body', 'new', 4, 'br')).toBe(second);
  expect(cache.snapshot()).toEqual({ storedBytes: 3, inFlightBytes: 0, entries: 1 });
});

test('bounded encoded storage evicts older bodies and never over-admits decoded work', async () => {
  const pending = pendingBytes();
  const busy = createEncodedFileCache({ maxBytes: 8, maxFileBytes: 6, encode: () => pending.promise });
  const first = busy.get('first', 'one', 6, 'br');
  expect(busy.get('oversized', 'one', 7, 'br')).toBeUndefined();
  expect(busy.get('busy', 'one', 3, 'br')).toBeUndefined();
  pending.finish(Buffer.from('123456'));
  await first;
  expect(busy.snapshot().inFlightBytes).toBe(0);
  const calls: string[] = [];
  const cache = createEncodedFileCache({ maxBytes: 8, encode: file => {
    calls.push(file); return Promise.resolve(Buffer.from('1234'));
  } });
  await cache.get('a', 'one', 4, 'br');
  await cache.get('b', 'one', 4, 'br');
  await cache.get('a', 'one', 4, 'br');
  await cache.get('c', 'one', 4, 'br');
  expect(cache.snapshot()).toEqual({ storedBytes: 8, inFlightBytes: 0, entries: 2 });
  await cache.get('b', 'one', 4, 'br');
  expect(calls).toEqual(['a', 'b', 'c', 'b']);
});

test('failed encoding remains visible and is not retained or retried implicitly', async () => {
  let calls = 0;
  const cache = createEncodedFileCache({ encode: () => {
    calls++; return Promise.reject(new Error('file read failed'));
  } });
  await expect(cache.get('body', 'one', 4, 'br')).rejects.toThrow('file read failed');
  expect(calls).toBe(1);
  expect(cache.snapshot()).toEqual({ storedBytes: 0, inFlightBytes: 0, entries: 0 });
  await expect(cache.get('body', 'one', 4, 'br')).rejects.toThrow('file read failed');
  expect(calls).toBe(2);
});

test('the native encoder preserves both complete representations', async () => {
  const file = 'scripts/preview-encoded-cache.mjs';
  // A live source read tests both encoders without a frozen source/output pin.
  const source = await readFile(file), cache = createEncodedFileCache();
  const br = await cache.get(file, 'current', source.length, 'br');
  const gzip = await cache.get(file, 'current', source.length, 'gzip');
  if (br === undefined || gzip === undefined) throw new Error('Small encoder fixture was not admitted');
  expect(brotliDecompressSync(br)).toEqual(source);
  expect(gunzipSync(gzip)).toEqual(source);
});

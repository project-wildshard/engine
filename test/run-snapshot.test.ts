// oxlint-disable-next-line import/no-nodejs-modules -- Each case owns and removes one snapshot directory.
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The snapshot directory lives under the repo's tmp root.
import { resolve } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { runSnapshot, runTextSnapshot } from './fixtures/runSnapshot';

const SHA = 'a'.repeat(40);
const directories: string[] = [];
const directory = (): string => {
  mkdirSync('tmp', { recursive: true }); const made = mkdtempSync(resolve('tmp', 'run-snapshot-'));
  directories.push(made); return made;
};
afterEach(() => { vi.unstubAllEnvs(); for (const made of directories.splice(0)) rmSync(made, { recursive: true, force: true }); });

const fixture = () => {
  const shared = Object.freeze({ kind: 'frozen' });
  return { bytes: Uint8Array.of(1, 2, 3), words: Uint32Array.of(7, 8), files: new Map([['a.glb', Uint8Array.of(9)], ['b.glb', Uint8Array.of(10, 11)]]),
    tags: new Set(['x', 'y']), zero: -0, shared, again: shared, list: [shared, { nested: [1, 2] }] };
};

test('a written snapshot reads back equal, frozen where it was, with each view owning an aligned buffer', async () => {
  const dir = directory();
  vi.stubEnv('WS_TEST_PRODUCTS_SHA', SHA); vi.stubEnv('WS_FIXTURE_SNAPSHOT_WRITE', dir);
  const written = await runSnapshot('case', () => Promise.resolve(fixture()));
  expect(readdirSync(dir)).toEqual(['case.v8']);
  vi.stubEnv('WS_FIXTURE_SNAPSHOT_WRITE', ''); vi.stubEnv('WS_FIXTURE_SNAPSHOTS', dir);
  const compute = vi.fn(() => Promise.resolve(fixture()));
  const read = await runSnapshot('case', compute);
  expect(compute).not.toHaveBeenCalled();
  expect(read).toStrictEqual(written);
  expect(Object.is(read.zero, -0)).toBe(true);
  expect(read.again).toBe(read.shared); expect(Object.isFrozen(read.shared)).toBe(true); expect(Object.isFrozen(read)).toBe(false);
  expect([...read.files.keys()]).toEqual(['a.glb', 'b.glb']);
  for (const view of [read.bytes, read.words, ...read.files.values()]) {
    expect(view.byteOffset).toBe(0); expect(view.byteLength).toBe(view.buffer.byteLength);
  }
  expect(new Uint32Array(read.words.buffer)).toEqual(Uint32Array.of(7, 8));
});

test('another commit, no commit, a missing file or a DOM realm compute instead', async () => {
  const dir = directory();
  vi.stubEnv('WS_TEST_PRODUCTS_SHA', SHA); vi.stubEnv('WS_FIXTURE_SNAPSHOT_WRITE', dir);
  await runSnapshot('case', () => Promise.resolve(fixture()));
  vi.stubEnv('WS_FIXTURE_SNAPSHOT_WRITE', ''); vi.stubEnv('WS_FIXTURE_SNAPSHOTS', dir);
  vi.stubEnv('WS_TEST_PRODUCTS_SHA', 'b'.repeat(40));
  await expect(runSnapshot('case', () => Promise.resolve(fixture()))).rejects.toThrow('belongs to another fixture or commit');
  vi.stubEnv('WS_TEST_PRODUCTS_SHA', SHA);
  await expect(runSnapshot('other', () => Promise.resolve(1))).resolves.toBe(1);
  vi.stubEnv('WS_TEST_PRODUCTS_SHA', '');
  await expect(runSnapshot('case', () => Promise.resolve(2))).resolves.toBe(2);
  vi.stubEnv('WS_TEST_PRODUCTS_SHA', SHA); Object.defineProperty(globalThis, 'document', { value: {}, configurable: true });
  try { await expect(runSnapshot('case', () => Promise.resolve(3))).resolves.toBe(3); } finally { Reflect.deleteProperty(globalThis, 'document'); }
});

test('the writer refuses values a structured clone would not return exactly', async () => {
  const dir = directory();
  vi.stubEnv('WS_TEST_PRODUCTS_SHA', SHA); vi.stubEnv('WS_FIXTURE_SNAPSHOT_WRITE', dir);
  class Row { readonly id = 1; }
  const buffer = new ArrayBuffer(8);
  const refused: readonly (readonly [string, unknown])[] = [
    ['instance', { row: new Row() }], ['accessor', Object.defineProperty({}, 'value', { get: () => 1, enumerable: true })],
    ['hidden', Object.defineProperty({}, 'value', { value: 1 })], ['symbol', { [Symbol('key')]: 1 }],
    ['sealed', Object.seal({ value: 1 })], ['shared', { a: new Uint8Array(buffer, 0, 4), b: new Uint8Array(buffer, 4, 4) }],
    ['null-prototype', Object.create(null)],
  ];
  for (const [name, value] of refused) await expect(runSnapshot(`refused-${name}`, () => Promise.resolve(value)), name).rejects.toThrow('would not clone exactly');
  expect(readdirSync(dir)).toEqual([]);
});

test('primitive compiler text crosses a DOM realm without granting object snapshot reuse', async () => {
  const dir = directory(), value = JSON.stringify({ code: ['raw', '\u0000', 'λ'], stamp: -0 });
  vi.stubEnv('WS_TEST_PRODUCTS_SHA', SHA); vi.stubEnv('WS_FIXTURE_SNAPSHOT_WRITE', dir);
  await runTextSnapshot('compiler', () => Promise.resolve(value));
  vi.stubEnv('WS_FIXTURE_SNAPSHOT_WRITE', ''); vi.stubEnv('WS_FIXTURE_SNAPSHOTS', dir);
  const compute = vi.fn(() => Promise.resolve('unexpected compiler call'));
  Object.defineProperty(globalThis, 'document', { value: {}, configurable: true });
  try {
    await expect(runTextSnapshot('compiler', compute)).resolves.toBe(value);
    expect(compute).not.toHaveBeenCalled();
    const objects = vi.fn(() => Promise.resolve({ ownRealm: true }));
    await expect(runSnapshot('compiler', objects)).resolves.toEqual({ ownRealm: true });
    expect(objects).toHaveBeenCalledOnce();
  } finally { Reflect.deleteProperty(globalThis, 'document'); }
});

test('text readers refuse nontext or wrong-commit artifacts and compute only missing entries', async () => {
  const dir = directory();
  vi.stubEnv('WS_TEST_PRODUCTS_SHA', SHA); vi.stubEnv('WS_FIXTURE_SNAPSHOT_WRITE', dir);
  await runSnapshot('object', () => Promise.resolve({ code: 'not a string' }));
  await runTextSnapshot('compiler', () => Promise.resolve('complete original envelope'));
  vi.stubEnv('WS_FIXTURE_SNAPSHOT_WRITE', ''); vi.stubEnv('WS_FIXTURE_SNAPSHOTS', dir);
  const compute = vi.fn(() => Promise.resolve('fresh envelope'));
  await expect(runTextSnapshot('object', compute)).rejects.toThrow('not primitive text');
  vi.stubEnv('WS_TEST_PRODUCTS_SHA', 'b'.repeat(40));
  await expect(runTextSnapshot('compiler', compute)).rejects.toThrow('belongs to another fixture or commit');
  expect(compute).not.toHaveBeenCalled();
  vi.stubEnv('WS_TEST_PRODUCTS_SHA', SHA);
  await expect(runTextSnapshot('missing', compute)).resolves.toBe('fresh envelope');
  expect(compute).toHaveBeenCalledOnce();
});

// @vitest-environment node
import {afterEach, expect, test, vi} from 'vitest';
import {entryTransport, installEntryTransport, startEntryDownload} from '../src/client/game/shardfile/entryTransport';

const key = Symbol.for('wildshard.entry-transport'), schedule = '/assets/entry-example-0123456789abcdef.json';
const hash = 'a'.repeat(64), origin = 'https://example.test';
const local = (): void => { vi.stubGlobal('localStorage', {clear: (): void => undefined}); };
local();
const address = (url: Parameters<typeof fetch>[0]): string => typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
function setup(rows: unknown, cached: unknown = {}): ReturnType<typeof vi.fn<typeof fetch>> {
  vi.stubGlobal('location', new URL(`${origin}/?chunk=example`));
  vi.stubGlobal('navigator', {userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5});
  vi.stubGlobal('document', {getElementById: () => ({textContent: JSON.stringify({entryDownloads: {example: {phone: schedule}}, entryIndexes: {example: '/shardfiles/example/shard.json?v=12345678'}})})});
  vi.stubGlobal('caches', {open: () => Promise.resolve({match: () => Promise.resolve(Response.json(cached))})});
  const read = vi.fn<typeof fetch>(url => Promise.resolve(address(url) === schedule ? Response.json(rows) : new Response(new Uint8Array([1, 2, 3]))));
  vi.stubGlobal('fetch', read);
  return read;
}
afterEach(() => {entryTransport()?.stop(); Reflect.deleteProperty(globalThis, key); vi.unstubAllGlobals(); local();});

test('early wire is borrowed exactly once without changing the bytes', async () => {
  const path = '/shardfiles/example/blobs/bin/body.bin', read = setup([{path, bytes: 3, members: [hash]}]);
  installEntryTransport();
  await vi.waitFor(() => expect(entryTransport()?.has(path)).toBe(true));
  expect(read.mock.calls.map(row => address(row[0]))).toEqual([schedule]);
  const response = await entryTransport()?.take(`${origin}${path}`);
  expect(response).toBeInstanceOf(Response);
  if (!response) throw new Error('Missing wire loan');
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  expect(await entryTransport()?.take(path)).toBeNull();
  expect(read.mock.calls.map(row => address(row[0]))).toEqual([schedule, path]);
});

test('warm member metadata suppresses read-ahead, not demand authority', async () => {
  const read = setup([{path: '/shardfiles/example/pack.pack', bytes: 3, members: [hash]}], {[hash]: {bytes: 3, used: 1}});
  installEntryTransport();
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  expect(await entryTransport()?.take('/shardfiles/example/pack.pack')).toBeNull();
});

test('one completed header pack stays parked until verified admission expands it', async () => {
  const rows = Array.from({length: 4}, (_, i) => ({path: `/shardfiles/example/${i}.bin`, bytes: 3, members: [hash], phase: i === 0 ? 'metadata' : 'body'}));
  const read = setup(rows); installEntryTransport();
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await new Promise<void>(resolve => {setImmediate(resolve);});
  expect(read).toHaveBeenCalledTimes(2);
  entryTransport()?.expand();
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(5));
});

test.each([
  {rows: [{path: '/shardfiles/foreign/body.bin', bytes: 3, members: [hash]}]},
  {rows: [{path: '/shardfiles/example/../body.bin', bytes: 3, members: [hash]}]},
  {rows: [{path: '/shardfiles/example/body.bin?x=1', bytes: 3, members: [hash]}]},
  {rows: [{path: '/shardfiles/example/body.bin', bytes: 3, members: [hash], phase: 'urgent'}]},
  {rows: [{path: '/shardfiles/example/body.bin', bytes: 25_000_001, members: [hash]}]},
  {rows: Array.from({length: 3}, (_, i) => ({path: `/shardfiles/example/${i}.bin`, bytes: 20_000_000, members: [hash]}))},
])('malformed/outside-budget schedule starts no body reads (%j)', async ({rows}) => {
  const read = setup(rows); installEntryTransport();
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  expect(entryTransport()?.has('/shardfiles/example/body.bin')).toBe(false);
});

test('oversized and partial responses fall back to original demand', async () => {
  const path = '/shardfiles/example/body.bin', read = setup([{path, bytes: 2, members: [hash]}]);
  installEntryTransport();
  await vi.waitFor(() => expect(entryTransport()?.has(path)).toBe(true));
  expect(await entryTransport()?.take(path)).toBeNull();
  expect(read).toHaveBeenCalledTimes(2);
});

test('six slots bound reads, queued demand borrows the same job and stop drains it', async () => {
  const rows = Array.from({length: 9}, (_, i) => ({path: `/shardfiles/example/${i}.bin`, bytes: 3, members: [hash], phase: i === 0 ? 'metadata' : 'body'}));
  const read = setup(rows), release: (() => void)[] = [];
  read.mockImplementation(async (url, init) => {
    if (address(url) === schedule) return Response.json(rows);
    await new Promise<void>(resolve => {release.push(resolve); init?.signal?.addEventListener('abort', () => {resolve();}, {once: true});});
    return new Response(new Uint8Array([1, 2, 3]));
  });
  installEntryTransport();
  await vi.waitFor(() => expect(release).toHaveLength(1));
  expect(read).toHaveBeenCalledTimes(2);
  entryTransport()?.expand();
  await vi.waitFor(() => expect(release).toHaveLength(6));
  expect(read).toHaveBeenCalledTimes(7);
  const queued = entryTransport()?.take(rows[8]?.path ?? '');
  entryTransport()?.stop();
  expect(await queued).toBeNull();
  expect(read).toHaveBeenCalledTimes(7);
});

test('cached metadata never promotes a large uncached body into the early slot', async () => {
  const header = '/shardfiles/example/header.pack', body = '/shardfiles/example/cover.bin', bodyHash = 'b'.repeat(64);
  const read = setup([{path: header, bytes: 3, members: [hash], phase: 'metadata'}, {path: body, bytes: 3, members: [bodyHash], phase: 'body'}], {[hash]: {bytes: 3}});
  installEntryTransport();
  await vi.waitFor(() => expect(entryTransport()?.has(body)).toBe(true));
  await new Promise<void>(resolve => {setImmediate(resolve);});
  expect(read.mock.calls.map(row => address(row[0]))).toEqual([schedule]);
  entryTransport()?.expand();
  await vi.waitFor(() => expect(read.mock.calls.map(row => address(row[0]))).toEqual([schedule, body]));
  const response = await entryTransport()?.take(body);
  expect(response).toBeInstanceOf(Response);
  if (response === null || response === undefined) throw new Error('Missing retained body');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
});

test('stopping during the cache hint cannot republish or start metadata loans', async () => {
  const path = '/shardfiles/example/header.pack', read = setup([{path, bytes: 3, members: [hash], phase: 'metadata'}]);
  let finish: ((response: Response) => void) | undefined;
  vi.stubGlobal('caches', {open: () => Promise.resolve({match: () => new Promise<Response>(resolve => {finish = resolve;})})});
  installEntryTransport();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  entryTransport()?.stop();
  finish?.(Response.json({}));
  await new Promise<void>(resolve => {setImmediate(resolve);});
  expect(read.mock.calls.map(row => address(row[0]))).toEqual([schedule]);
  expect(entryTransport()?.has(path)).toBe(false);
});

test('a real tap starts the versioned index request across navigation', () => {
  const read = setup([]); startEntryDownload('example');
  expect(read).toHaveBeenCalledWith('/shardfiles/example/shard.json?v=12345678', {keepalive: true, priority: 'high'});
});

test('PZ3: with a content base the read-ahead reads there, and a loan answers its page or content URL', async () => {
  const path = '/shardfiles/example/blobs/bin/body.bin', cdn = 'https://packs.example.test', read = setup([{path, bytes: 3, members: [hash]}]);
  vi.stubGlobal('document', {getElementById: () => ({textContent: JSON.stringify({contentBase: `${cdn}/`, entryDownloads: {example: {phone: schedule}}})})});
  read.mockImplementation(url => Promise.resolve(address(url) === `${cdn}${schedule}` ? Response.json([{path, bytes: 3, members: [hash]}]) : new Response(new Uint8Array([1, 2, 3]))));
  installEntryTransport();
  await vi.waitFor(() => expect(entryTransport()?.has(`${cdn}${path}`)).toBe(true));
  expect(entryTransport()?.has(path)).toBe(true);
  entryTransport()?.expand();
  const response = await entryTransport()?.take(`${cdn}${path}`);
  expect(response).toBeInstanceOf(Response);
  expect(read.mock.calls.map(row => address(row[0]))).toEqual([`${cdn}${schedule}`, `${cdn}${path}`]);
});

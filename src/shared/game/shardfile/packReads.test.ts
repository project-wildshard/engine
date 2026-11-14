import { expect, test, vi } from 'vitest';
import { packMissing, packOrLoose, packReads, readPackWhole, releasePackWholes } from './packReads';

const a = 'a'.repeat(64), b = 'b'.repeat(64), hash = 'f'.repeat(64);
const pack = { hash, bytes: 4, path: 'blobs/pack/example.pack', entries: [
  { hash: a, offset: 0, bytes: 2 }, { hash: b, offset: 2, bytes: 2 }] };

test('partial phases leave pack bodies to their actual demand', async () => {
  const read = vi.fn(() => Promise.resolve(Uint8Array.of(1, 2, 3, 4)));
  const phase = packReads([pack], new Set([a]), read, () => Promise.resolve(hash));
  expect(phase.has(a)).toBe(false); expect(phase.has(b)).toBe(false);
  await expect(phase.read(a)).rejects.toThrow('Not a packed member');
  expect(read).not.toHaveBeenCalled();
});

test('complete phases verify once and return exact detached members', async () => {
  const wire = Uint8Array.of(1, 2, 3, 4), read = vi.fn(() => Promise.resolve(wire));
  const digest = vi.fn(() => Promise.resolve(hash));
  const phase = packReads([pack], new Set([a, b]), read, digest);
  const [first, second] = await Promise.all([phase.read(a), phase.read(b)]);
  expect(first).toEqual(Uint8Array.of(1, 2)); expect(second).toEqual(Uint8Array.of(3, 4));
  expect(read).toHaveBeenCalledExactlyOnceWith(pack.path, 4, pack.entries);
  expect(digest).toHaveBeenCalledExactlyOnceWith(wire);
  first[0] = 9; expect(wire).toEqual(Uint8Array.of(1, 2, 3, 4));
});

test('complete phase keeps both size and hash refusals', async () => {
  for (const [bytes, actual, own] of [[Uint8Array.of(1, 2, 3), hash, '7'.repeat(64)], [Uint8Array.of(1, 2, 3, 4), a, '8'.repeat(64)]] as const) {
    const bad = { ...pack, hash: own };
    const phase = packReads([bad], new Set([a, b]), () => Promise.resolve(bytes), () => Promise.resolve(actual === hash ? own : actual));
    await expect(phase.read(a)).rejects.toThrow('Shardfile pack hash or size mismatch');
    // PZ7: a pack with other bytes is refused, never read around, and a repaired read may retry it
    expect(packMissing(bad)).toBe(false); expect(phase.has(a)).toBe(true);
    await expect(packOrLoose(() => phase.read(a), () => Promise.resolve(Uint8Array.of(1)))).rejects.toThrow('mismatch');
  }
});

test('an intersecting partial pack cannot hide a later complete envelope', async () => {
  const complete = { hash: '1'.repeat(64), path: 'blobs/pack/complete.pack', bytes: 2,
    entries: [{ hash: a, offset: 0, bytes: 2 }] };
  const read = vi.fn((path: string) => Promise.resolve(path === complete.path ? Uint8Array.of(1, 2) : Uint8Array.of(1, 2, 3, 4)));
  const phase = packReads([pack, complete], new Set([a]), read,
    bytes => Promise.resolve(bytes.length === 2 ? complete.hash : pack.hash));
  expect(await phase.read(a)).toEqual(Uint8Array.of(1, 2));
  expect(read).toHaveBeenCalledExactlyOnceWith(complete.path, 2, complete.entries);
});


test('separate phase readers share the same verified pack across later waves', async () => {
  const packs = [pack], wire = Uint8Array.of(1, 2, 3, 4), read = vi.fn(() => Promise.resolve(wire));
  const digest = vi.fn(() => Promise.resolve(hash));
  const first = packReads(packs, new Set([a, b]), read, digest);
  expect(await first.read(a)).toEqual(Uint8Array.of(1, 2));
  const later = packReads(packs, new Set([a, b]), read, digest);
  expect(await later.read(b)).toEqual(Uint8Array.of(3, 4));
  expect(read).toHaveBeenCalledOnce(); expect(digest).toHaveBeenCalledOnce();
});


test('separate parses of an immutable index coalesce in-flight whole reads without sharing mutable members', async () => {
  const wire = Uint8Array.of(1, 2, 3, 4), read = vi.fn(() => Promise.resolve(wire)), digest = vi.fn(() => Promise.resolve(hash));
  const first = packReads([pack], new Set([a, b]), read, digest);
  const other = packReads([{ ...pack, entries: structuredClone(pack.entries) }], new Set([a, b]), read, digest);
  const [left, right] = await Promise.all([first.read(a), other.read(b)]);
  left[0] = 99;
  expect(right).toEqual(Uint8Array.of(3, 4)); expect(await other.read(a)).toEqual(Uint8Array.of(1, 2));
  expect(read).toHaveBeenCalledOnce(); expect(digest).toHaveBeenCalledOnce();
});

test('a released pack leaves every owner table and is read again rather than held for the page', async () => {
  const released = { ...pack, hash: 'e'.repeat(64) }, owner = {}, other = {};
  const read = vi.fn(() => Promise.resolve(Uint8Array.of(1, 2, 3, 4))), digest = () => Promise.resolve(released.hash);
  await readPackWhole(owner, released, read, digest, {});
  await readPackWhole(owner, released, read, digest, {});
  await readPackWhole(other, released, read, digest, {});
  expect(read).toHaveBeenCalledTimes(2);
  releasePackWholes([released]);
  await readPackWhole(other, released, read, digest, {});
  expect(read).toHaveBeenCalledTimes(3);
  // after release a read in flight is still shared, but nothing settled is kept: the next wave reads again
  const [first, second] = await Promise.all([readPackWhole(owner, released, read, digest, {}), readPackWhole(owner, released, read, digest, {})]);
  expect(first).toBe(second); expect(read).toHaveBeenCalledTimes(4);
  await readPackWhole(owner, released, read, digest, {});
  expect(read).toHaveBeenCalledTimes(5);
});

test('PZ7: a pack that fails to read is remembered, and its members read loose from then on', async () => {
  const dropped = { ...pack, hash: 'd'.repeat(64) };
  const read = vi.fn(() => Promise.reject(new Error('404')));
  const phase = packReads([dropped], new Set([a, b]), read, () => Promise.resolve(dropped.hash));
  expect(phase.has(a)).toBe(true);
  const loose = vi.fn(() => Promise.resolve(Uint8Array.of(7, 7)));
  expect(await packOrLoose(() => phase.read(a), loose)).toEqual(Uint8Array.of(7, 7));
  expect(packMissing(dropped)).toBe(true);
  expect(phase.has(a)).toBe(false); expect(phase.has(b)).toBe(false);
  await expect(readPackWhole({}, dropped, read, () => Promise.resolve(dropped.hash))).rejects.toThrow('Shardfile pack is missing');
  expect(read).toHaveBeenCalledOnce(); expect(loose).toHaveBeenCalledOnce();
});

test('PZ7: an aborted pack read is not remembered as missing and still throws', async () => {
  const held = { ...pack, hash: 'c'.repeat(64) }, abort = Object.assign(new Error('stop'), { name: 'AbortError' });
  const phase = packReads([held], new Set([a, b]), () => Promise.reject(abort), () => Promise.resolve(held.hash));
  await expect(packOrLoose(() => phase.read(a), () => Promise.resolve(Uint8Array.of(1)))).rejects.toBe(abort);
  expect(packMissing(held)).toBe(false); expect(phase.has(a)).toBe(true);
});

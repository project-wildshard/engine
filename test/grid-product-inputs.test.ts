import { expect, test, vi } from 'vitest';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { hashImmutableBytes } from '@wildshard/engine/host/immutable';
import type { AdmittedProduct, ProductOptions } from '../src/client/game/shardfile/product';
import { APPROACH_INPUT_READS, ProductInputs, readWindow } from '../src/client/game/grid/productInputs';
import { accountTransportRelease } from '../src/client/game/grid/products';

function fixture(transportOnly = false) {
  const source = emptyShardfile({ slug: 'input-lease', name: 'Inputs', author: 'Test', revision: 1, seed: 1 });
  const bytes = Uint8Array.of(1, 2, 3), ref = hashImmutableBytes(bytes), wire = new Map(transportOnly ? [] : [[ref, bytes]]);
  source.files.push({ hash: ref, kind: 'binary', compressed: bytes.length, decoded: bytes.length, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false });
  let durable = true, corrupted = false, held = 0;
  const fetch = vi.fn(() => Promise.resolve(new Response(corrupted ? Uint8Array.of(3, 2, 1) : bytes)));
  const options: ProductOptions = { base: 'https://inputs.test/', offline: false, firstParty: true, fetch, hash: value => Promise.resolve(hashImmutableBytes(value)),
    cache: { product: () => Promise.resolve(null), putProduct: () => Promise.resolve(), putAsset: () => Promise.resolve(true),
      asset: async () => new Uint8Array(await (await fetch()).arrayBuffer()) } };
  const releasePreparedTransport = vi.fn((refs: Iterable<string>) => {
    const released = durable ? [...refs] : [];
    for (const key of released) wire.delete(key);
    return Promise.resolve(released);
  });
  const admitted: AdmittedProduct = { source, assets: wire, cached: false, releasePreparedTransport };
  const inputs = new ProductInputs(admitted, options, count => {
    held += count; let remaining = count;
    return { shrink: next => { held += next - remaining; remaining = next; }, release: () => { held -= remaining; remaining = 0; } };
  }, new Set(), transportOnly ? [ref] : undefined);
  return { inputs, wire, ref, bytes, fetch, releasePreparedTransport, admitted, options, held: () => held,
    durable: (value: boolean) => { durable = value; }, corrupt: () => { corrupted = true; } };
}

test('an approach refills released selected transport and shares it with the real constructor', async () => {
  const f = fixture(true), controller = new AbortController();
  const metadata = await f.inputs.acquire(); expect(metadata.assets.size).toBe(0); await metadata.release();
  expect(f.fetch).not.toHaveBeenCalled();
  const warm = await f.inputs.acquireTransport(controller.signal);
  expect(warm.assets.get(f.ref)).toEqual(f.bytes); expect(f.held()).toBe(3);
  const actual = await f.inputs.acquire(); expect(actual.assets).toBe(warm.assets);
  await warm.release(); expect(actual.assets.get(f.ref)).toEqual(f.bytes); expect(f.held()).toBe(3);
  await actual.release(); expect(f.held()).toBe(0); expect(actual.assets.size).toBe(0);
});

test('corrupt selected approach transport never publishes or retains its temporary claim', async () => {
  const f = fixture(true); f.corrupt();
  await expect(f.inputs.acquireTransport(new AbortController().signal)).rejects.toThrow('hash or size mismatch');
  expect(f.held()).toBe(0); const actual = await f.inputs.acquire(); expect(actual.assets.size).toBe(0); await actual.release();
});

test('approach cancellation drains its started window of reads and starts no suffix', async () => {
  const source = emptyShardfile({ slug: 'approach-window', name: 'Window', author: 'Test', revision: 1, seed: 1 });
  const bytes = Array.from({ length: APPROACH_INPUT_READS + 2 }, (_, i) => Uint8Array.of(i + 1)), hashes = bytes.map(hashImmutableBytes);
  for (const [i, hash] of hashes.entries()) source.files.push({ hash, kind: 'binary', compressed: bytes[i]?.length ?? 0, decoded: 1, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false });
  const finish: (() => void)[] = [], started: string[] = [];
  const options: ProductOptions = { base: 'https://inputs.test/', offline: false, firstParty: true, fetch: () => Promise.reject(new Error('Unexpected network')),
    hash: value => Promise.resolve(hashImmutableBytes(value)), cache: { product: () => Promise.resolve(null), putProduct: () => Promise.resolve(), putAsset: () => Promise.resolve(true),
      asset: (_base, hash) => new Promise(resolve => { started.push(hash); finish.push(() => { resolve(bytes[hashes.indexOf(hash)] ?? null); }); }) } };
  let held = 0;
  const admitted: AdmittedProduct = { source, assets: new Map(), cached: false };
  const inputs = new ProductInputs(admitted, options, count => { held += count; return { shrink: next => { held = next; }, release: () => { held = 0; } }; }, new Set(), hashes);
  const controller = new AbortController(), pending = inputs.acquireTransport(controller.signal);
  const refused = expect(pending).rejects.toThrow('Approach input acquisition cancelled');
  await vi.waitFor(() => { expect(started).toHaveLength(APPROACH_INPUT_READS); });
  controller.abort(); expect(held).toBe(APPROACH_INPUT_READS + 2);
  for (const release of finish) release(); await refused;
  expect(started).toEqual(hashes.slice(0, APPROACH_INPUT_READS)); expect(held).toBe(0);
  const actual = await inputs.acquire(); expect(actual.assets.size).toBe(0); await actual.release();
});

test('overlapping preparations pin both mirrors until their last idempotent release', async () => {
  const f = fixture(), first = await f.inputs.acquire(), second = await f.inputs.acquire();
  expect(first.assets.get(f.ref)).toBe(f.bytes); expect(second.assets).toBe(first.assets);
  await first.release(); await first.release();
  expect(f.wire.has(f.ref)).toBe(true); expect(f.inputs.reader.retained.has(f.ref)).toBe(true);
  expect(f.releasePreparedTransport).not.toHaveBeenCalled();
  await second.release();
  expect(first.assets.size).toBe(0); expect(f.wire.size).toBe(0); expect(f.inputs.reader.retained.size).toBe(0);
});

test('late preparation rehydrates verified bytes with a temporary charged claim', async () => {
  const f = fixture(), first = await f.inputs.acquire(); await first.release();
  const next = await f.inputs.acquire();
  expect(next.assets.get(f.ref)).toEqual(f.bytes); expect(next.assets.get(f.ref)).not.toBe(f.bytes);
  expect(f.fetch).toHaveBeenCalledOnce(); expect(f.held()).toBe(f.bytes.length);
  await next.release(); expect(next.assets.size).toBe(0); expect(f.held()).toBe(0);
});

test('unreleasable offline inputs keep their bytes and need no reread', async () => {
  const f = fixture(); f.durable(false);
  const first = await f.inputs.acquire(); await first.release();
  expect(f.wire.get(f.ref)).toBe(f.bytes); expect(f.inputs.reader.retained.get(f.ref)).toBe(f.bytes);
  const next = await f.inputs.acquire(); expect(next.assets.get(f.ref)).toBe(f.bytes);
  expect(f.fetch).not.toHaveBeenCalled(); await next.release();
});

test('corrupt rehydration refuses before publication and releases its temporary claim', async () => {
  const f = fixture(), first = await f.inputs.acquire(); await first.release(); f.corrupt();
  await expect(f.inputs.acquire()).rejects.toThrow('hash or size mismatch');
  expect(f.held()).toBe(0); expect(first.assets.size).toBe(0);
});

test('an acquire during asynchronous retirement waits, then receives refilled inputs', async () => {
  const f = fixture(), first = await f.inputs.acquire();
  let finish: (() => void) | undefined;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  f.releasePreparedTransport.mockImplementationOnce(async refs => { await wait; const result = [...refs]; for (const key of result) f.wire.delete(key); return result; });
  const retirement = first.release(); await Promise.resolve(); await Promise.resolve();
  const loading = f.inputs.acquire();
  if (finish === undefined) throw new Error('Missing retirement gate'); finish();
  await retirement; const next = await loading;
  expect(next.assets.get(f.ref)).toEqual(f.bytes); await next.release(); expect(f.held()).toBe(0);
});

test('concurrent late borrowers share one verified refill and one temporary claim', async () => {
  const f = fixture(), first = await f.inputs.acquire(); await first.release();
  const [left, right] = await Promise.all([f.inputs.acquire(), f.inputs.acquire()]);
  expect(f.fetch).toHaveBeenCalledOnce(); expect(f.held()).toBe(3);
  await left.release(); expect(right.assets.get(f.ref)).toEqual(f.bytes); expect(f.held()).toBe(3);
  await right.release(); expect(f.held()).toBe(0);
});

test('failed persistence after a refill keeps its wire claim until a verified release succeeds', async () => {
  const f = fixture(), first = await f.inputs.acquire(); await first.release();
  const next = await f.inputs.acquire(); f.durable(false); await next.release();
  expect(next.assets.get(f.ref)).toEqual(f.bytes); expect(f.held()).toBe(3);
  const again = await f.inputs.acquire(); expect(f.fetch).toHaveBeenCalledOnce();
  f.durable(true); await again.release(); expect(again.assets.size).toBe(0); expect(f.held()).toBe(0);
});

test('the charged lazy-input subset survives completed preparation without extra reads', async () => {
  const f = fixture(), reserve = vi.fn(() => ({ shrink: vi.fn(), release: vi.fn() }));
  const inputs = new ProductInputs(f.admitted, f.options, reserve, new Set([f.ref]));
  const first = await inputs.acquire(); await first.release();
  expect(first.assets.get(f.ref)).toBe(f.bytes); expect(inputs.reader.retained.get(f.ref)).toBe(f.bytes);
  const next = await inputs.acquire(); expect(next.assets.get(f.ref)).toBe(f.bytes);
  expect(f.fetch).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled(); await next.release();
});

test('decoder releases do not shrink bytes still pinned by preparation mirrors', async () => {
  const f = fixture(), released = vi.fn<(bytes: number) => void>();
  f.admitted.releaseTransport = refs => { const result = [...refs]; for (const ref of result) f.wire.delete(ref); return Promise.resolve(result); };
  accountTransportRelease(f.admitted, count => { released(count); }, ref => f.inputs.retains(ref));
  const input = await f.inputs.acquire();
  await f.admitted.releaseTransport([f.ref]);
  expect(released).toHaveBeenLastCalledWith(0); expect(input.assets.get(f.ref)).toBe(f.bytes);
  await input.release(); expect(released).toHaveBeenLastCalledWith(3);
  await input.release(); expect(released.mock.calls.map(([count]) => count)).toEqual([0, 3]);
});

test('GC6: the read window slides: one slow read never holds the reads after it, and a failure starts no more', async () => {
  // QA 11-14 row 6: lockstep batches of four waited on each batch's slowest read (Nalati's 860 inputs: 20 s at 18 fps)
  const started: string[] = [], finish = new Map<string, () => void>();
  const refs = ['slow', 'a', 'b', 'c', 'd', 'e'];
  const done = readWindow(refs, 2, () => undefined, ref => new Promise<void>(resolve => { started.push(ref); finish.set(ref, resolve); }));
  await vi.waitFor(() => { expect(started).toEqual(['slow', 'a']); });
  for (const ref of ['a', 'b', 'c', 'd']) { finish.get(ref)?.(); await vi.waitFor(() => { expect(started).toContain(refs[refs.indexOf(ref) + 1]); }); }
  expect(started).toEqual(refs); // 'slow' still in flight while every other read started
  finish.get('e')?.(); finish.get('slow')?.(); await done;
  const tried: string[] = [];
  await expect(readWindow(['x', 'y', 'z'], 1, () => undefined, ref => { tried.push(ref); return ref === 'y' ? Promise.reject(new Error('bad y')) : Promise.resolve(); })).rejects.toThrow('bad y');
  expect(tried).toEqual(['x', 'y']);
});

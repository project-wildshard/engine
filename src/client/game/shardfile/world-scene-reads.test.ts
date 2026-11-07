import { expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { WorldSceneReads } from './worldSceneReads';

function fixture(count = 20) {
  const scope = new Scope('entered'), resident = new Scope('resident'), names = Array.from({ length: count }, (_, index) => `scene-${index}`);
  const pending = names.map((_, index) => {
    let settle: (value: Uint8Array) => void = () => undefined, fail: (error: Error) => void = () => undefined;
    const promise = new Promise<Uint8Array>((resolve, reject) => { settle = resolve; fail = reject; });
    return { promise, release: () => { settle(new Uint8Array([index])); }, fail };
  });
  const started: string[] = [];
  const product = { hasFile: (name: string) => names.includes(name), file: vi.fn((name: string) => {
    started.push(name); const read = pending[names.indexOf(name)];
    if (read === undefined) throw new Error('Unknown fixture read'); return read.promise;
  }) };
  const ctx = { scope, product };
  const release = () => { for (const read of pending) read.release(); };
  return { scope, resident, names, pending, started, product, ctx, release };
}
async function refusal(pending: Promise<unknown>): Promise<unknown> { try { return await pending; } catch (error) { return error; } }
const turn = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('one shared pool starts sixteen ordered reads, refills free slots and deduplicates names', async () => {
  const f = fixture(), pool = new WorldSceneReads(f.ctx, f.resident, [...f.names, ...f.names]);
  try {
    await turn(); expect(f.started).toEqual(f.names.slice(0, 16));
    f.pending[7]?.release(); await turn(); expect(f.started).toEqual(f.names.slice(0, 17));
    const a = pool.file('scene-7'), b = pool.file('scene-7'); expect(await a).toBe(await b);
    f.release(); await turn(); expect(f.started).toEqual(f.names);
    expect((await pool.file('scene-19'))[0]).toBe(19); expect(f.product.file).toHaveBeenCalledTimes(20);
  } finally { f.release(); await pool.close(); f.scope.dispose(); f.resident.dispose(); }
});

test('a speculative failure stops the queue, drains started reads and keeps the cursor error', async () => {
  const f = fixture(), pool = new WorldSceneReads(f.ctx, f.resident, f.names);
  try {
    await turn(); f.pending[8]?.fail(new Error('Later read failed')); await turn();
    const later = refusal(pool.file('scene-8')); expect(await later).toEqual(new Error('Later read failed'));
    let closed = false; const closing = (async () => { await pool.close(); closed = true; })();
    await turn(); expect(closed).toBe(false); expect(f.started).toHaveLength(16);
    f.release(); await closing; expect(closed).toBe(true); expect(f.started).toHaveLength(16);
  } finally { f.release(); await pool.close(); f.scope.dispose(); f.resident.dispose(); }
});

test.each(['entered', 'resident'] as const)('ancestor retirement of the %s owner cancels queued reads and refuses held bytes', async which => {
  const f = fixture(), parent = new Scope('ancestor');
  const owner = parent.child('nested');
  const ctx = which === 'entered' ? { ...f.ctx, scope: owner } : f.ctx;
  const pool = new WorldSceneReads(ctx, which === 'resident' ? owner : f.resident, f.names);
  try {
    await turn(); const result = refusal(pool.file('scene-0'));
    parent.onDisposeSteps(function* sliced() { yield; yield; });
    const slices = parent.disposeSteps(); slices.next(); expect(owner.disposing).toBe(true);
    f.release(); expect(await result).toEqual(new Error('Scene placement owner is disposed'));
    await pool.close(); expect(f.started).toHaveLength(16); Array.from(slices);
  } finally { f.release(); await pool.close(); parent.dispose(); f.scope.dispose(); f.resident.dispose(); }
});

test.each(['product', 'file', 'scope'] as const)('replacing the original %s refuses before consuming bytes or scheduling more reads', async which => {
  const f = fixture(), pool = new WorldSceneReads(f.ctx, f.resident, f.names), replacement = new Scope('replacement');
  try {
    await turn(); const result = refusal(pool.file('scene-0'));
    if (which === 'product') Object.assign(f.ctx, { product: { ...f.product } });
    else if (which === 'file') f.product.file = vi.fn(() => Promise.resolve(new Uint8Array()));
    else Object.assign(f.ctx, { scope: replacement });
    f.release(); expect(await result).toEqual(new Error('Scene read owner changed'));
    await pool.close(); expect(f.started).toHaveLength(16);
  } finally { f.release(); await pool.close(); replacement.dispose(); f.scope.dispose(); f.resident.dispose(); }
});

test('missing declared suffix refuses before any read or lifetime capture', () => {
  const f = fixture();
  try {
    const before = f.scope.census.disposers;
    expect(() => new WorldSceneReads(f.ctx, f.resident, [...f.names, 'absent'])).toThrow('Missing world scene blob');
    expect(f.product.file).not.toHaveBeenCalled(); expect(f.scope.census.disposers).toBe(before);
  } finally { f.scope.dispose(); f.resident.dispose(); }
});

test('a synchronous reader throw is handled and closing prevents any later reads', async () => {
  const f = fixture(1); f.product.file = vi.fn(() => { throw new Error('Synchronous refusal'); });
  const pool = new WorldSceneReads(f.ctx, f.resident, f.names);
  try {
    await expect(pool.file('scene-0')).rejects.toThrow('Synchronous refusal'); await pool.close();
    await expect(pool.file('scene-0')).rejects.toThrow('stopped');
    expect(f.product.file).toHaveBeenCalledTimes(1);
  } finally { await pool.close(); f.scope.dispose(); f.resident.dispose(); }
});

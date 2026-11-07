import { expect, test } from 'vitest';
import { PreparationReads } from '../src/client/game/shardfile/preparationReads';

function fixture() {
  const rows = Array.from({ length: 14 }, (_, i) => i), started: number[] = [];
  const gates = new Map<number, { resolve: (bytes: Uint8Array) => void; reject: (reason: Error) => void }>();
  let live = true, running = 0, peak = 0;
  const reads = new PreparationReads(rows, row => {
    started.push(row); running++; peak = Math.max(peak, running);
    return new Promise<Uint8Array>((resolve, reject) => { gates.set(row, { resolve, reject }); }).finally(() => { running--; });
  }, () => live);
  const finish = async (row: number): Promise<void> => {
    const gate = gates.get(row); if (gate === undefined) throw new Error('Read never started');
    gate.resolve(Uint8Array.of(row));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  };
  return { reads, rows, started, gates, finish, peak: () => peak, retire: () => { live = false; }, drain: async () => {
    const closing = reads.close(); for (const [row, gate] of gates) gate.resolve(Uint8Array.of(row)); await closing;
  } };
}

test('phase reads refill on any completion before an ordered consumer advances; peak is six', async () => {
  const f = fixture();
  try {
    expect(f.started).toEqual([0, 1, 2, 3, 4, 5]);
    await f.finish(5); expect(f.started).toEqual([0, 1, 2, 3, 4, 5, 6]);
    await f.finish(6); expect(f.started).toHaveLength(8);
    const later = f.reads.take(8); // Queued segmented callers may ask before a slot starts.
    await f.finish(7); await f.finish(8);
    expect(await later).toEqual(Uint8Array.of(8));
    await f.finish(0); expect(await f.reads.take(0)).toEqual(Uint8Array.of(0));
    expect(f.peak()).toBe(6);
  } finally { await f.drain(); }
});

test('close stops queued reads and drains every started read before releasing the phase', async () => {
  const f = fixture();
  let closed = false;
  const closing = f.reads.close().then(() => { closed = true; return undefined; });
  await Promise.resolve(); expect(closed).toBe(false);
  await f.finish(0); expect(closed).toBe(false); expect(f.started).toHaveLength(6);
  for (let row = 1; row < 6; row++) await f.finish(row);
  await closing; expect(closed).toBe(true); expect(f.started).toHaveLength(6);
});

test('a later read rejection is observed in cursor order and drains pending work', async () => {
  const f = fixture(), original = new Error('verified file refusal');
  try {
    f.gates.get(3)?.reject(original);
    await f.finish(0);
    expect(await f.reads.take(0)).toEqual(Uint8Array.of(0));
    await expect(f.reads.take(3)).rejects.toBe(original);
    await expect(f.reads.take(8)).rejects.toBe(original);
    expect(f.started).toHaveLength(6);
  } finally { await f.drain(); }
});

test('retirement prevents suffix reads without abandoning started verification', async () => {
  const f = fixture();
  try {
    f.retire(); await f.finish(0);
    await expect(f.reads.take(6)).rejects.toThrow('disposed or retiring');
    expect(f.started).toHaveLength(6);
  } finally { await f.drain(); }
});

test('a synchronous refusal keeps its identity and never starts a suffix', async () => {
  const original = new Error('synchronous source refusal');
  let calls = 0;
  const reads = new PreparationReads([0, 1, 2], () => { calls++; throw original; }, () => true);
  await expect(reads.take(0)).rejects.toBe(original);
  await expect(reads.take(2)).rejects.toBe(original);
  await reads.close(); expect(calls).toBe(1);
});


test('overlapping scene and whole phases share six slots and neither phase starves', async () => {
  const a = fixture(), b = fixture();
  try {
    expect(a.started).toHaveLength(6); expect(b.started).toHaveLength(0);
    await a.finish(0); // The first refill rotates the earlier phase behind its peer.
    await a.finish(1);
    expect(b.started).toEqual([0]);
    await b.finish(0); expect(a.started).toHaveLength(8);
  } finally { await Promise.all([a.drain(), b.drain()]); }
});

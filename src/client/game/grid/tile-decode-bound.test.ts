import { afterEach, expect, test, vi } from 'vitest';
import { TileDecoder, type TileDecodeReply, type TileDecodeRequest } from './tileDecoder';
import type { TerrainTileData } from '@wildshard/format/terrainTileBytes';

const workers: ControlledWorker[] = [];
let refuseWorker = false;
let refuseAfter: number | undefined;
const previousWorker = globalThis.Worker;
class ControlledWorker {
  onmessage: ((event: MessageEvent<TileDecodeReply>) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  readonly sent: TileDecodeRequest[] = [];
  terminated = false;
  constructor() { if (refuseWorker || workers.length === refuseAfter) throw new Error('Worker startup refused'); workers.push(this); }
  postMessage(request: TileDecodeRequest, transfer: Transferable[] = []): void { this.sent.push(structuredClone(request, { transfer })); }
  terminate(): void { this.terminated = true; }
  reply(data: TerrainTileData): void {
    const request = this.sent.at(-1); if (request === undefined) throw new Error('No active decode');
    this.onmessage?.(new MessageEvent('message', { data: { id: request.id, data } }));
  }
}
const tile: TerrainTileData = { resolution: 2, size: 1, x: 0, z: 0, heights: new Float32Array(4) };
afterEach(() => { vi.useRealTimers(); vi.stubGlobal('Worker', previousWorker); workers.length = 0; refuseWorker = false; refuseAfter = undefined; });

test('an unused decoder creates no workers or idle deadline until its first decode', async () => {
  vi.useFakeTimers(); vi.stubGlobal('Worker', ControlledWorker);
  const decoder = new TileDecoder(2), bytes = Uint8Array.of(1, 2);
  try {
    expect(workers).toHaveLength(0); expect(decoder.threaded).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(workers).toHaveLength(0);
    const first = decoder.decode(bytes, {transfer: true});
    expect(workers).toHaveLength(2); expect(decoder.threaded).toBe(true);
    await Promise.resolve(); expect(bytes.byteLength).toBe(0);
    workers[0]?.reply(tile); expect(await first).toBe(tile);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(workers.every(worker => worker.terminated)).toBe(true);
  } finally { decoder.dispose(); }
});

test('disposing an unused decoder cannot start workers or detach later input', async () => {
  vi.stubGlobal('Worker', ControlledWorker);
  const decoder = new TileDecoder(2), bytes = Uint8Array.of(1, 2);
  decoder.dispose();
  await expect(decoder.decode(bytes, {transfer: true})).rejects.toThrow('disposed');
  expect(workers).toHaveLength(0); expect(bytes).toEqual(Uint8Array.of(1, 2));
});

test('a partial first startup retires its workers and leaves input attached', async () => {
  vi.stubGlobal('Worker', ControlledWorker);
  refuseAfter = 1;
  const decoder = new TileDecoder(2), bytes = Uint8Array.of(1, 2);
  await expect(decoder.decode(bytes, {transfer: true})).rejects.toThrow('Worker startup refused');
  expect(workers).toHaveLength(1); expect(workers[0]?.terminated).toBe(true);
  expect(workers[0]?.onmessage).toBe(null); expect(workers[0]?.onerror).toBe(null);
  expect(bytes).toEqual(Uint8Array.of(1, 2));
  await expect(decoder.decode(bytes)).rejects.toThrow('disposed');
});

test('parallel tile reads create at most one wire copy per busy worker', async () => {
  vi.stubGlobal('Worker', ControlledWorker);
  const decoder = new TileDecoder(2), sources = Array.from({ length: 6 }, (_, i) => Uint8Array.of(i));
  const copies = sources.map(source => vi.spyOn(source, 'slice'));
  const pending = sources.map(source => decoder.decode(source));
  await Promise.resolve();
  expect(workers.map(worker => worker.sent.length)).toEqual([1, 1]);
  expect(copies.map(copy => copy.mock.calls.length)).toEqual([1, 1, 0, 0, 0, 0]);
  for (let wave = 0; wave < 3; wave++) {
    for (const worker of workers) worker.reply(tile);
    await Promise.all(pending.slice(wave * 2, wave * 2 + 2));
  }
  expect((await Promise.all(pending)).every(value => value === tile)).toBe(true);
  expect(workers.map(worker => worker.sent.map(request => new Uint8Array(request.bytes)[0]))).toEqual([[0, 2, 4], [1, 3, 5]]);
  expect(sources.map(source => source.byteLength)).toEqual(Array.from({ length: 6 }, () => 1));
  decoder.dispose();
});

test('worker failure retires active and queued tiles without copying the queue', async () => {
  vi.stubGlobal('Worker', ControlledWorker);
  const decoder = new TileDecoder(1), first = Uint8Array.of(1), queued = Uint8Array.of(2);
  const copy = vi.spyOn(queued, 'slice'), result = Promise.allSettled([decoder.decode(first), decoder.decode(queued)]);
  await Promise.resolve();
  workers[0]?.onerror?.({ message: 'decode failed' });
  expect((await result).map(row => row.status)).toEqual(['rejected', 'rejected']);
  expect(copy).not.toHaveBeenCalled(); expect(workers.every(worker => worker.terminated)).toBe(true);
  await expect(decoder.decode(first)).rejects.toThrow('disposed');
});

test('idle workers retire and restart with the same transferred decode contract', async () => {
  vi.useFakeTimers(); vi.stubGlobal('Worker', ControlledWorker);
  const decoder = new TileDecoder(2);
  try {
    const first = decoder.decode(Uint8Array.of(1));
    await Promise.resolve(); workers[0]?.reply(tile); expect(await first).toBe(tile);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(workers).toHaveLength(2); expect(workers.every(worker => worker.terminated)).toBe(true);
    expect(decoder.threaded).toBe(false);
    const owned = Uint8Array.of(2, 3), resumed = decoder.decode(owned, { transfer: true });
    await Promise.resolve();
    expect(owned.byteLength).toBe(0); expect(decoder.threaded).toBe(true); expect(workers).toHaveLength(4);
    const active = workers.slice(2).find(worker => worker.sent.length === 1);
    if (active === undefined) throw new Error('Missing resumed decode');
    expect(new Uint8Array(active.sent[0]?.bytes ?? new ArrayBuffer(0))).toEqual(Uint8Array.of(2, 3));
    expect(active.sent[0]?.id).not.toBe(workers[0]?.sent[0]?.id);
    workers[0]?.reply(tile); // A retired worker's old reply cannot settle the successor.
    expect(active.terminated).toBe(false);
    active.reply(tile); expect(await resumed).toBe(tile);
  } finally { decoder.dispose(); }
  await expect(decoder.decode(Uint8Array.of(4))).rejects.toThrow('disposed');
});

test('an active or queued decode cannot be retired by the idle timer', async () => {
  vi.useFakeTimers(); vi.stubGlobal('Worker', ControlledWorker);
  const decoder = new TileDecoder(1), one = Uint8Array.of(1), two = Uint8Array.of(2);
  const first = decoder.decode(one), second = decoder.decode(two);
  try {
    await Promise.resolve(); await vi.advanceTimersByTimeAsync(60_000);
    expect(workers[0]?.terminated).toBe(false); expect(workers[0]?.sent).toHaveLength(1);
    workers[0]?.reply(tile); await first; await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(workers[0]?.terminated).toBe(false); expect(workers[0]?.sent).toHaveLength(2);
    workers[0]?.reply(tile); await second;
    await vi.advanceTimersByTimeAsync(29_999); expect(workers[0]?.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(workers[0]?.terminated).toBe(true);
    expect(one.byteLength).toBe(1); expect(two.byteLength).toBe(1);
  } finally { decoder.dispose(); }
});

test('new work cancels the previous idle deadline and non-whole views stay attached', async () => {
  vi.useFakeTimers(); vi.stubGlobal('Worker', ControlledWorker);
  const decoder = new TileDecoder(1);
  try {
    const first = decoder.decode(Uint8Array.of(1)); await Promise.resolve(); workers[0]?.reply(tile); await first;
    await vi.advanceTimersByTimeAsync(29_000);
    const owner = Uint8Array.of(0, 2, 3, 0), view = owner.subarray(1, 3), second = decoder.decode(view, { transfer: true });
    await Promise.resolve(); await vi.advanceTimersByTimeAsync(2_000);
    expect(workers[0]?.terminated).toBe(false); expect(workers).toHaveLength(1);
    expect(owner).toEqual(Uint8Array.of(0, 2, 3, 0)); expect(view).toEqual(Uint8Array.of(2, 3));
    workers[0]?.reply(tile); expect(await second).toBe(tile);
    decoder.dispose(); await vi.advanceTimersByTimeAsync(60_000);
    expect(workers).toHaveLength(1); expect(workers[0]?.terminated).toBe(true);
  } finally { decoder.dispose(); }
});

test('a refused first decode on an unused pool leaves input attached', async () => {
  vi.useFakeTimers(); vi.stubGlobal('Worker', ControlledWorker);
  const decoder = new TileDecoder(2), bytes = Uint8Array.of(1);
  try {
    await vi.advanceTimersByTimeAsync(30_000);
    expect(workers.every(worker => worker.terminated)).toBe(true);
    refuseWorker = true;
    await expect(decoder.decode(bytes, { transfer: true })).rejects.toThrow('Worker startup refused');
    expect(bytes).toEqual(Uint8Array.of(1));
    await expect(decoder.decode(bytes)).rejects.toThrow('disposed');
  } finally { decoder.dispose(); }
});

// oxlint-disable-next-line import/no-nodejs-modules -- Native fixtures exercise the standard frame grammar and byte decoder bridge.
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { expect, test, vi } from 'vitest';
import { zstdLaneSize } from './zstdFrame';
import { decodeLaneBytes } from './deflate';

const frame = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => Uint8Array.from(zstdCompressSync(bytes,
  { params: { [constants.ZSTD_c_compressionLevel]: 19 } }));

test.each([0, 4, 256, 65_536, 131_076])('a standard frame declares exactly %i decoded lane bytes', size => {
  const raw = Uint8Array.from({ length: size }, (_, index) => (index * 79 + 31) & 255), packed = frame(raw);
  const backing = new Uint8Array(packed.length + 11); backing.set(packed, 7);
  expect(zstdLaneSize(backing.subarray(7, 7 + packed.length))).toBe(size);
  expect(zstdDecompressSync(packed)).toEqual(Buffer.from(raw));
  expect(zstdLaneSize(new Uint8Array([0x78, 0xda]))).toBeNull();
});

test('malformed, trailing, dictionary and excessive lane frames refuse before decoding', () => {
  const packed = frame(new Uint8Array(16));
  for (let length = 4; length < packed.length; length++) expect(() => zstdLaneSize(packed.subarray(0, length))).toThrow();
  const trailing = new Uint8Array(packed.length + 1); trailing.set(packed);
  expect(() => zstdLaneSize(trailing)).toThrow('trailing');
  for (const bit of [1, 2, 8, 16]) {
    const bad = packed.slice(); bad[4] = (bad[4] ?? 0) | bit;
    expect(() => zstdLaneSize(bad)).toThrow('Unsupported');
  }
  expect(() => zstdLaneSize(frame(new Uint8Array(3)))).toThrow('whole words');
  // Single segment, four-byte content size: no huge output is allocated.
  const excessive = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0xa0, 4, 0, 0, 4, 1, 0, 0]);
  expect(() => zstdLaneSize(excessive)).toThrow('bounded');
  const unbounded = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 0, 1, 0, 0]);
  expect(() => zstdLaneSize(unbounded)).toThrow('decoded size');
});

interface RequestRow { id: number; levels: { data: Uint8Array; size: number }[] }

test('admitted zstd lanes use an owned transfer and restore every word without private URL IO', async () => {
  vi.useFakeTimers();
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected private URL'));
  const requests: RequestRow[] = [], held: (() => void)[] = [];
  let notifyPosted = (): void => undefined;
  const posted = new Promise<void>(resolve => { notifyPosted = resolve; });
  let truncate = false, failWorker = false, terminated = 0, hold = true;
  class DecodeWorker extends EventTarget {
    postMessage(input: RequestRow, options: StructuredSerializeOptions): void {
      const request = structuredClone(input, options); requests.push(request); notifyPosted();
      const complete = (): void => {
        if (failWorker) { this.dispatchEvent(new Event('error', { cancelable: true })); return; }
        const levels = request.levels.map(level => Uint8Array.from(zstdDecompressSync(level.data)));
        const first = levels[0]; if (truncate && first !== undefined) levels[0] = first.slice(0, -1);
        this.dispatchEvent(new MessageEvent('message', { data: { id: request.id, levels } }));
      };
      if (hold) held.push(complete); else queueMicrotask(complete);
    }
    terminate(): void { terminated++; }
  }
  vi.stubGlobal('Worker', DecodeWorker);
  try {
    // Signed zero, a noncanonical NaN and arbitrary index words retain their bits.
    const raw = new Uint8Array(new Uint32Array([0x80000000, 0x7fc00001, 0xffffffff, 0x3f800000]).buffer);
    const lanes = Uint8Array.from({ length: raw.length }, (_, index) => raw[index % 4 * 4 + Math.floor(index / 4)] ?? 0);
    const packed = frame(lanes), original = packed.slice();
    const decoded = decodeLaneBytes(packed);
    let delivered = false;
    const observed = decoded.then(bytes => { delivered = true; return bytes; });
    // Native module loading is not driven by fake time. Start the held-result
    // clock only after the lazy decoder has actually transferred its request.
    await Promise.race([posted, observed.then(() => { throw new Error('Held decode completed before its reply'); })]);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(delivered).toBe(false); expect(terminated).toBe(0); expect(vi.getTimerCount()).toBe(0);
    hold = false;
    const complete = held.shift(); if (complete === undefined) throw new Error('Missing worker request');
    complete(); expect(await observed).toEqual(raw);
    expect(await decoded).toEqual(raw); expect(packed).toEqual(original);
    expect(requests).toHaveLength(1); expect(requests[0]?.levels[0]?.size).toBe(raw.length);
    const mutable = packed.slice(), captured = decodeLaneBytes(mutable); mutable.fill(255);
    await vi.advanceTimersByTimeAsync(0); expect(await captured).toEqual(raw);
    truncate = true;
    const refused = expect(decodeLaneBytes(packed)).rejects.toThrow('byte count');
    await vi.advanceTimersByTimeAsync(0); await refused;
    expect(packed).toEqual(original); expect(fetch).not.toHaveBeenCalled();
    const before = requests.length;
    await expect(decodeLaneBytes(packed.subarray(0, -1))).rejects.toThrow('Truncated');
    expect(requests).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(30_001); expect(terminated).toBe(1);
    failWorker = true;
    const broken = expect(decodeLaneBytes(packed)).rejects.toThrow('worker failed');
    await vi.advanceTimersByTimeAsync(0); await broken;
    await expect(decodeLaneBytes(packed)).rejects.toThrow('worker unavailable');
    expect(requests).toHaveLength(before + 1); expect(terminated).toBe(2);
    expect(fetch).not.toHaveBeenCalled(); expect(packed).toEqual(original);
  } finally { vi.unstubAllGlobals(); clock.mockRestore(); fetch.mockRestore(); vi.useRealTimers(); }
});

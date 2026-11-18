import { afterEach, expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Node's zstd writes the fixture as the SDK bake does, and decodes it.
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib';

/** A raw RGBA8 KTX2 with one zstd level, laid out as sharddev/bake/texture.ts `bakeRawColourTexture` writes it. */
function rawZstdKtx2(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const packed = zstdCompressSync(pixels, { params: { [constants.ZSTD_c_compressionLevel]: 19 } });
  const descriptor = 92, offset = 104 + descriptor, out = new Uint8Array(offset + packed.length), view = new DataView(out.buffer);
  out.set([171, 75, 84, 88, 32, 50, 48, 187, 13, 10, 26, 10]);
  [43, 1, width, height, 0, 0, 1, 1, 2, 104, descriptor].forEach((value, i) => { view.setUint32(12 + i * 4, value, true); });
  view.setBigUint64(80, BigInt(offset), true); view.setBigUint64(88, BigInt(packed.length), true); view.setBigUint64(96, BigInt(pixels.length), true);
  view.setUint32(104, descriptor, true);
  out.set(packed, offset);
  return out;
}

interface Posted { id: number; levels: { data: Uint8Array; size: number }[] }
const realWorker: unknown = Reflect.get(globalThis, 'Worker');
afterEach(() => { Reflect.set(globalThis, 'Worker', realWorker); });

// ENGINE-MEMORY EM19: a burst of files copies out and posts at most two files' levels at a time; the rest wait on the page
// as views into their own files, not as copies in the worker's queue
test('at most two files are copied out and posted to the decoder at once', async () => {
  const posted: Posted[] = [], replies: ((event: MessageEvent) => void)[] = [];
  class FakeWorker {
    addEventListener(type: string, listener: (event: MessageEvent) => void): void { if (type === 'message') replies.push(listener); }
    removeEventListener(): void { /* unused */ }
    postMessage(message: Posted): void { posted.push(message); }
    terminate(): void { /* unused */ }
  }
  Reflect.set(globalThis, 'Worker', FakeWorker);
  const { unsupercompressKtx2 } = await import('./ktx2Zstd');
  const size = 8 * 4 * 4, files = Array.from({ length: 5 }, (_, i) => rawZstdKtx2(new Uint8Array(size).fill(i + 1), 8, 4));
  const results = files.map(file => unsupercompressKtx2(Uint8Array.from(file).buffer));
  await vi.waitFor(() => { expect(posted).toHaveLength(2); });
  await new Promise<void>(resolve => { setTimeout(resolve, 20); });
  expect(posted).toHaveLength(2); // the third file waits for a turn
  for (let i = 0; i < files.length; i++) {
    await vi.waitFor(() => { expect(posted.length).toBeGreaterThan(0); });
    expect(posted.length).toBeLessThanOrEqual(2);
    const message = posted.shift();
    if (message === undefined) throw new Error('nothing posted');
    const reply = new MessageEvent('message', { data: { id: message.id, levels: message.levels.map(level => new Uint8Array(zstdDecompressSync(level.data))) } });
    for (const listener of replies) listener(reply);
  }
  const plain = await Promise.all(results);
  plain.forEach((buffer, i) => {
    const view = new DataView(buffer), offset = Number(view.getBigUint64(80, true));
    expect(view.getUint32(44, true)).toBe(0); // stored plain
    expect(new Uint8Array(buffer, offset, size)).toEqual(new Uint8Array(size).fill(i + 1));
  });
});

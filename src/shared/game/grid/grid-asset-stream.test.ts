// @vitest-environment node
import { expect, test } from 'vitest';
import { readGridAssetBytes } from './gridAssetBytes';

async function address(bytes: Uint8Array<ArrayBuffer>): Promise<{ url: string; bytes: number; sha256: string }> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer)), sha256 = Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
  return { url: `/assets/grid-strip-mesh-${sha256.slice(0, 8)}.bin`, bytes: bytes.length, sha256 };
}
function source(bytes: Uint8Array, step: number, direct: boolean, fail = false) {
  let offset = 0, cancelled = 0, requests = 0;
  const stream = direct ? new ReadableStream({
    type: 'bytes',
    pull(controller) {
      if (fail && requests > 0) { controller.error(new Error('Transport aborted')); return; }
      const request = controller.byobRequest;
      if (request === null || request.view === null) throw new Error('Missing direct request');
      requests++;
      if (offset === bytes.length) { controller.close(); request.respond(0); return; }
      const target = new Uint8Array(request.view.buffer, request.view.byteOffset, request.view.byteLength), count = Math.min(step, target.length, bytes.length - offset);
      target.set(bytes.subarray(offset, offset + count)); offset += count; request.respond(count);
    },
    cancel() { cancelled++; },
  }) : new ReadableStream<Uint8Array>({
    pull(controller) {
      if (fail && requests > 0) { controller.error(new Error('Transport aborted')); return; }
      requests++;
      if (offset === bytes.length) { controller.close(); return; }
      const count = Math.min(step, bytes.length - offset); controller.enqueue(bytes.slice(offset, offset + count)); offset += count;
    },
    cancel() { cancelled++; },
  });
  return { stream, get cancelled() { return cancelled; }, get requests() { return requests; } };
}
test.each([false, true])('complete bytes, digest and exact EOF survive stream mode %s', async direct => {
  for (const step of [1, 31, 2048]) {
    const bytes = Uint8Array.from({ length: 1031 }, (_, i) => (i * 31) % 256), input = source(bytes, step, direct);
    const wire = await readGridAssetBytes(await address(bytes), () => Promise.resolve(new Response(input.stream)), 'strips');
    expect(wire).toEqual(bytes); expect(wire.buffer.byteLength).toBe(bytes.length);
    expect(input.cancelled).toBe(0); expect(input.requests).toBeGreaterThan(1);
    bytes.fill(0); expect(wire.some(value => value !== 0)).toBe(true);
  }
});
test.each([false, true])('short, overlong, changed and aborted bodies refuse in stream mode %s', async direct => {
  const expected = Uint8Array.from({ length: 64 }, (_, i) => i + 1), locator = await address(expected);
  for (const bytes of [expected.subarray(0, 63), new Uint8Array(65), new Uint8Array(8192)]) {
    const input = source(bytes, 17, direct);
    await expect(readGridAssetBytes(locator, () => Promise.resolve(new Response(input.stream)), 'strips')).rejects.toThrow('size differs');
    if (bytes.length === 8192) expect(input.cancelled).toBe(1);
  }
  const changed = source(new Uint8Array(64), 17, direct);
  await expect(readGridAssetBytes(locator, () => Promise.resolve(new Response(changed.stream)), 'strips')).rejects.toThrow('differs from the build');
  const aborted = source(expected, 17, direct, true);
  await expect(readGridAssetBytes(locator, () => Promise.resolve(new Response(aborted.stream)), 'strips')).rejects.toThrow('Transport aborted');
});
test('invalid address, oversized admission, HTTP and missing body still refuse', async () => {
  const locator = await address(new Uint8Array(4)); let reads = 0;
  const read = () => { reads++; return Promise.resolve(new Response()); };
  await expect(readGridAssetBytes({ ...locator, bytes: 16 * 1024 * 1024 + 1 }, read, 'strips')).rejects.toThrow('Invalid');
  await expect(readGridAssetBytes({ ...locator, url: '/assets/foreign.bin' }, read, 'strips')).rejects.toThrow('Invalid'); expect(reads).toBe(0);
  await expect(readGridAssetBytes(locator, () => Promise.resolve(new Response(null, { status: 404 })), 'strips')).rejects.toThrow('404');
  await expect(readGridAssetBytes(locator, read, 'strips')).rejects.toThrow('body is missing');
});
test('custom direct methods retain the copying fallback and cannot lend mutable payload backing', async () => {
  const bytes = Uint8Array.from({ length: 64 }, (_, i) => i + 1), locator = await address(bytes);
  const stream = new ReadableStream({ type: 'bytes', start(controller) { controller.enqueue(bytes.slice()); controller.close(); } });
  const getReader = stream.getReader.bind(stream); let customReads = 0;
  Object.defineProperty(stream, 'getReader', { value: (options?: ReadableStreamGetReaderOptions) => {
    if (options?.mode !== 'byob') return getReader();
    const reader = getReader({ mode: 'byob' });
    Object.defineProperty(reader, 'read', { value: () => { customReads++; return Promise.resolve({ done: false, value: bytes }); } });
    return reader;
  } });
  const wire = await readGridAssetBytes(locator, () => Promise.resolve(new Response(stream)), 'strips');
  expect(customReads).toBe(0); expect(wire).toEqual(bytes);
  bytes.fill(0); expect(wire[63]).toBe(64);
});
test('a reader method replaced during a native pull cannot replace the bound read', async () => {
  const bytes = Uint8Array.from({ length: 64 }, (_, i) => i + 1), locator = await address(bytes);
  let active: ReadableStreamBYOBReader | undefined, offset = 0, customReads = 0;
  const stream = new ReadableStream({ type: 'bytes', pull(controller) {
    if (active === undefined) throw new Error('Missing native reader');
    Object.defineProperty(active, 'read', { configurable: true, value: () => { customReads++; return Promise.resolve({ done: false, value: bytes }); } });
    const request = controller.byobRequest;
    if (request === null || request.view === null) throw new Error('Missing direct request');
    if (offset === bytes.length) { controller.close(); request.respond(0); return; }
    const target = new Uint8Array(request.view.buffer, request.view.byteOffset, request.view.byteLength), count = Math.min(8, target.length, bytes.length - offset);
    target.set(bytes.subarray(offset, offset + count)); offset += count; request.respond(count);
  } });
  const acquire = stream.getReader.bind(stream);
  Object.defineProperty(stream, 'getReader', { value: (options?: ReadableStreamGetReaderOptions) => {
    if (options?.mode !== 'byob') throw new Error('Native stream should retain direct reads');
    active = acquire({ mode: 'byob' }); return active;
  } });
  const wire = await readGridAssetBytes(locator, () => Promise.resolve(new Response(stream)), 'strips');
  expect(customReads).toBe(0); expect(wire).toEqual(bytes);
  bytes.fill(0); expect(wire[63]).toBe(64);
});

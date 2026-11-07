import { expect, test } from 'vitest';
import { realGc } from '../../../test/engine/realGc';
import { readContentResponse } from './readContentResponse';

test('copies exact multi-chunk bytes into detached full-length storage', async () => {
  const original = new Uint8Array([0, 1, 2, 3, 4]);
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(original.subarray(1, 3)); controller.enqueue(original.subarray(3)); controller.close();
  } }));
  const bytes = await readContentResponse(response, 4);
  expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  expect(bytes.buffer).not.toBe(original.buffer);
  expect(bytes.byteOffset).toBe(0); expect(bytes.buffer.byteLength).toBe(4);
});

test('releases consumed chunks before the download finishes', async () => {
  await realGc('src/client/engine/boot/readContentResponse.test.ts', 'releases consumed chunks before the download finishes', async collect => {
    let first: WeakRef<object> | undefined, count = 0;
    let release = (): void => { throw new Error('Missing stream release'); };
    let arrived = (): void => { throw new Error('Missing stream arrival'); };
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { arrived = resolve; });
    const response = new Response(new ReadableStream<Uint8Array>({ async pull(controller) {
      if (count < 2) {
        const chunk = new Uint8Array(1024 * 1024).fill(++count);
        if (count === 1) first = new WeakRef(chunk.buffer);
        controller.enqueue(chunk);
      } else { arrived(); await blocked; controller.close(); }
    } }, { highWaterMark: 0 }));
    const pending = readContentResponse(response, 2 * 1024 * 1024);
    try {
      await ready;
      if (first === undefined) throw new Error('Missing consumed backing');
      await collect(first);
    } finally { release(); }
    const bytes = await pending;
    expect(bytes.length).toBe(2 * 1024 * 1024);
    expect(bytes.every((byte, index) => byte === (index < 1024 * 1024 ? 1 : 2))).toBe(true);
  });
});

test('refuses oversize streams immediately and cancels without retaining the reader', async () => {
  let cancelled = false, pulls = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    pulls++; controller.enqueue(new Uint8Array([1, 2, 3]));
  }, cancel() { cancelled = true; } }, { highWaterMark: 0 }));
  await expect(readContentResponse(response, 2)).rejects.toThrow('declared size');
  expect(pulls).toBe(1); expect(cancelled).toBe(true);
});

test('preserves short and empty lengths for the caller exact-size refusal', async () => {
  expect(await readContentResponse(new Response(new Uint8Array([1])), 2)).toEqual(new Uint8Array([1]));
  expect(await readContentResponse(new Response(null), 0)).toEqual(new Uint8Array());
  expect(await readContentResponse(new Response(null), 2)).toHaveLength(0);
  await expect(readContentResponse(new Response(null, { status: 500 }), 0)).rejects.toThrow('Read failed');
});

test('stream errors release the reader and never return a partial body', async () => {
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('network lost')); } }));
  await expect(readContentResponse(response, 2)).rejects.toThrow('network lost');
});

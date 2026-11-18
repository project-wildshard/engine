import { expect, test } from 'vitest';
import { pooledScratch, SCRATCH_BYTES, scratchReader } from './scratchReader';

/** A byte stream that answers each pull with the next chunk, copied into the reader's lent view when it has one. */
function byteStream(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array<ArrayBuffer>> {
  let next = 0;
  return new ReadableStream({
    type: 'bytes',
    pull(controller) {
      const chunk = chunks[next++];
      if (chunk === undefined) { controller.close(); controller.byobRequest?.respond(0); return; }
      const request = controller.byobRequest;
      if (request?.view === null || request === null) { controller.enqueue(chunk.slice()); return; }
      new Uint8Array(request.view.buffer, request.view.byteOffset, request.view.byteLength).set(chunk);
      request.respond(chunk.byteLength);
    },
  });
}

async function drain(reader: ReturnType<typeof scratchReader>): Promise<{ bytes: number[]; sizes: Set<number> }> {
  const bytes: number[] = [], sizes = new Set<number>();
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    sizes.add(part.value.buffer.byteLength); bytes.push(...part.value);
  }
  return { bytes, sizes };
}

test('a byte stream is read through one reused scratch buffer, which goes back to the pool', async () => {
  const before = pooledScratch();
  const { bytes, sizes } = await drain(scratchReader(byteStream([new Uint8Array([1, 2, 3]), new Uint8Array([4]), new Uint8Array([5, 6])])));
  expect(bytes).toEqual([1, 2, 3, 4, 5, 6]);
  // every chunk is a view of the same lent memory (BYOB transfers the buffer to the stream and back each read)
  expect([...sizes]).toEqual([SCRATCH_BYTES]);
  expect(pooledScratch()).toBe(Math.max(before, 1));
  // the next read takes the pooled buffer instead of making one
  const again = scratchReader(byteStream([new Uint8Array([7])]));
  expect(pooledScratch()).toBe(Math.max(before, 1) - 1);
  expect((await drain(again)).bytes).toEqual([7]);
});

test('a stream that is not a byte stream is read by its default reader unchanged', async () => {
  const chunk = new Uint8Array([9, 8, 7]);
  const reader = scratchReader(new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) { controller.enqueue(chunk); controller.close(); } }));
  const first = await reader.read();
  expect(first.done).toBe(false);
  expect(first.value).toBe(chunk);
  expect((await reader.read()).done).toBe(true);
});

test('cancel ends the read and keeps the scratch buffer', async () => {
  const before = pooledScratch();
  const reader = scratchReader(byteStream([new Uint8Array([1]), new Uint8Array([2])]));
  expect((await reader.read()).value).toEqual(new Uint8Array([1]));
  await reader.cancel();
  expect(pooledScratch()).toBe(Math.max(before, 1));
  expect((await reader.read()).done).toBe(true);
});

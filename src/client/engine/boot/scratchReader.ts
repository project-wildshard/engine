/**
 * MEMORY-GATES MG10 (mini-ninemem4): a fetch body read through a few reused scratch buffers instead of one new buffer per
 * network chunk. A default reader hands every chunk over in an ArrayBuffer of its own; the caller copies it into its
 * destination and drops it, so a whole download's bytes pass through the heap a second time as garbage. On Nine's phone
 * boot that was ~230 MB of dead chunk buffers by `ready`, which Chromium kept until a major GC (backing stores ~490 MB at
 * the loading peak, ~140 MB live). A BYOB reader fills a buffer the caller lends instead: here one scratch buffer per
 * open read, taken from a small pool and given back when the read ends.
 *
 * `read()` answers like a default reader's, but each chunk is a view of the scratch buffer, valid only until the next
 * `read()` or `cancel()`: the caller copies it out first (every caller here copies into its own destination). A body
 * that is not a byte stream (a test's ReadableStream, an engine without BYOB) is read by its default reader unchanged.
 */
import { ownedBuffer } from '../../../shared/engine/core/ownedBuffer';

export interface BodyReader {
  readonly read: () => Promise<ReadableStreamReadResult<Uint8Array<ArrayBuffer>>>;
  readonly cancel: (reason?: unknown) => Promise<void>;
}

/** Each read fills at most this much (network chunks are mostly 16-64 KB). Every open read holds one while it waits, and
 *  Nine opens ~120 at once, so a scratch buffer stays small. */
export const SCRATCH_BYTES: number = 64 * 1024;
/** Scratch buffers kept between reads (2 MB): the boot's steady parallel reads allocate none. */
const POOL_KEPT = 32;
const pool: ArrayBuffer[] = [];

function take(): ArrayBuffer { return pool.pop() ?? ownedBuffer(SCRATCH_BYTES, { owner: 'engine/scratchReader', kind: 'scratch' }); }
function give(buffer: ArrayBuffer | null): void {
  // a buffer handed to a read that failed stays with the stream (detached here): nothing to give back
  if (buffer !== null && buffer.byteLength === SCRATCH_BYTES && pool.length < POOL_KEPT) pool.push(buffer);
}

/** The reader for `body`: through reused scratch buffers when it is a byte stream, else its default reader. */
export function scratchReader(body: ReadableStream<Uint8Array<ArrayBuffer>>): BodyReader {
  let byob: ReadableStreamBYOBReader;
  try { byob = body.getReader({ mode: 'byob' }); }
  catch { return body.getReader(); }
  let scratch: ArrayBuffer | null = take(), ended = false;
  const end = (): void => { if (ended) return; ended = true; give(scratch); scratch = null; };
  return {
    read: async () => {
      if (ended) return { done: true, value: undefined };
      // the read takes the buffer (it is detached here until the answer gives the same memory back)
      const lent = scratch ?? take();
      scratch = null;
      let result: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>;
      try { result = await byob.read(new Uint8Array(lent, 0, SCRATCH_BYTES)); }
      catch (error) { ended = true; throw error; }
      if (result.value !== undefined) scratch = result.value.buffer;
      if (result.done) { end(); return { done: true, value: undefined }; }
      return result;
    },
    cancel: async (reason?: unknown) => { end(); await byob.cancel(reason); },
  };
}

/** Scratch buffers waiting in the pool (tests). */
export function pooledScratch(): number { return pool.length; }

import { pageScope } from '../../../shared/engine/app/resources';
import { WORK_SLICE_MS, workSlice } from '../../../shared/engine/core/workSlice';
import { zstdLaneSize } from './zstdFrame';

/** Fetch zlib-compressed bytes without feeding a whole network chunk to the native
 * decoder in one continuation. The existing work slice gives live frames their
 * turn between 16 KiB input blocks; decoded bytes and ownership stay unchanged. */
export async function fetchDeflatedBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok || response.body === null) throw new Error(`${String(response.status)} ${url}`);
  return inflateStream(response.body);
}
async function inflateStream(body: ReadableStream<Uint8Array<ArrayBuffer>>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader(), slice = workSlice(WORK_SLICE_MS, pageScope);
  let chunk: Uint8Array<ArrayBuffer> | undefined, offset = 0;
  const input = new ReadableStream<BufferSource>({
    async pull(controller) {
      if (chunk === undefined || offset === chunk.length) {
        const next = await reader.read();
        if (next.done) { controller.close(); return; }
        chunk = next.value; offset = 0;
      }
      await slice.check();
      const end = Math.min(chunk.length, offset + 16_384);
      controller.enqueue(chunk.subarray(offset, end)); offset = end;
    },
    async cancel(reason: unknown) { await reader.cancel(reason); },
  });
  try { return new Uint8Array(await new Response(input.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()); }
  finally { await reader.cancel(); }
}

/** Base64 text as bytes (an inline block): one pass over the decoded text, never a mapper call per byte (G639: Nalati's grass
 *  maps spent ~60 ms of one grid-entry frame in `Uint8Array.from(atob(text), …)`). */
export function base64Bytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text), out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.codePointAt(i) ?? 0;
  return out;
}

const LITTLE_ENDIAN_WORDS = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** Restore a range of four-byte words from their four byte lanes into a distinct complete buffer.
 * Aligned little-endian outputs use one word store; other layouts retain byte stores. */
export function unshuffleLanes(lanes: Uint8Array, out: Uint8Array<ArrayBuffer> = new Uint8Array(lanes.length), wordStart = 0, wordEnd: number = lanes.length / 4): Uint8Array {
  if (lanes.length % 4 !== 0) throw new Error('unshuffleLanes: not whole words');
  const n = lanes.length / 4;
  if (out.length !== lanes.length || out.buffer === lanes.buffer || !Number.isSafeInteger(wordStart) || !Number.isSafeInteger(wordEnd)
    || wordStart < 0 || wordEnd < wordStart || wordEnd > n) throw new Error('unshuffleLanes: bad output/range');
  if (wordStart === wordEnd) return out;
  if (LITTLE_ENDIAN_WORDS && out.byteOffset % 4 === 0) {
    const words = new Uint32Array(out.buffer, out.byteOffset, n), third = n * 2, fourth = n * 3;
    let i = wordStart;
    // Four little-endian reads hold four bytes from each lane, including
    // unaligned lane starts. Transpose without changing the slice boundary.
    if (wordStart + 3 < wordEnd) {
      const source = new DataView(lanes.buffer, lanes.byteOffset, lanes.byteLength);
      for (; i + 3 < wordEnd; i += 4) {
        const a = source.getUint32(i, true), b = source.getUint32(n + i, true);
        const c = source.getUint32(third + i, true), d = source.getUint32(fourth + i, true);
        words[i] = (a & 255) | ((b & 255) << 8) | ((c & 255) << 16) | (d << 24);
        words[i + 1] = ((a >>> 8) & 255) | (b & 65280) | ((c & 65280) << 8) | ((d & 65280) << 16);
        words[i + 2] = ((a >>> 16) & 255) | ((b >>> 8) & 65280) | (c & 16711680) | ((d & 16711680) << 8);
        words[i + 3] = (a >>> 24) | ((b >>> 16) & 65280) | ((c >>> 8) & 16711680) | (d & 4278190080);
      }
    }
    for (; i < wordEnd; i++) {
      words[i] = (lanes[i] ?? 0) | ((lanes[n + i] ?? 0) << 8) | ((lanes[third + i] ?? 0) << 16) | ((lanes[fourth + i] ?? 0) << 24);
    }
    return out;
  }
  for (let i = wordStart; i < wordEnd; i++) {
    const at = i * 4;
    out[at] = lanes[i] ?? 0; out[at + 1] = lanes[n + i] ?? 0;
    out[at + 2] = lanes[2 * n + i] ?? 0; out[at + 3] = lanes[3 * n + i] ?? 0;
  }
  return out;
}

/** Inflate and restore byte lanes in page-lived slices; cached reads survive a retired construction owner. */
export async function fetchLaneBytes(url: string): Promise<Uint8Array> {
  return restoreLaneBytes(await fetchDeflatedBytes(url));
}
/** zlib bytes already in hand, inflated by the platform's paced stream decoder (as `fetchDeflatedBytes`); the input is not kept. */
export function inflateBytes(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const body = new Response(bytes.slice()).body;
  if (body === null) return Promise.reject(new Error('Inflate requires a byte stream'));
  return inflateStream(body);
}
/** Decode admitted lane bytes. Size-declared Zstd uses the existing worker;
 * original zlib files retain native paced inflate. Both restore identical words. */
export async function decodeLaneBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const owned = bytes.slice();
  const size = zstdLaneSize(owned);
  if (size !== null) {
    const { decodeZstdBlock } = await import('./ktx2Zstd');
    return restoreLaneBytes(await decodeZstdBlock(owned, size));
  }
  const body = new Response(owned).body;
  if (body === null) throw new Error('Lane bake requires a byte stream');
  return restoreLaneBytes(await inflateStream(body));
}
async function restoreLaneBytes(lanes: Uint8Array): Promise<Uint8Array> {
  const out = new Uint8Array(lanes.length), slice = workSlice(WORK_SLICE_MS, pageScope), words = lanes.length / 4;
  for (let start = 0; start < words; start += 16_384) {
    await slice.check();
    unshuffleLanes(lanes, out, start, Math.min(words, start + 16_384));
  }
  return out;
}

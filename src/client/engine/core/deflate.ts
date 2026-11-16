import { base64Bytes as decodeBase64, unshuffleLanes as restoreWords, decodeDeflatedLanes, inflateDeflatedBytes } from '../../../shared/engine/core/byteCodec';
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

/** Compatibility entry for existing page consumers; codecs are defined at the
 * public app-independent byteCodec module. */
export function base64Bytes(text: string): Uint8Array<ArrayBuffer> { return decodeBase64(text); }
/** Existing page entry retains the caller-owned range interface. */
export function unshuffleLanes(lanes: Uint8Array, out?: Uint8Array<ArrayBuffer>, wordStart = 0, wordEnd: number = lanes.length / 4): Uint8Array {
  return restoreWords(lanes, out, wordStart, wordEnd);
}

/** Inflate and restore byte lanes in page-lived slices; cached reads survive a retired construction owner. */
export async function fetchLaneBytes(url: string): Promise<Uint8Array> {
  return restoreLaneBytes(await fetchDeflatedBytes(url));
}
/** zlib bytes already in hand, inflated by the platform's paced stream decoder (as `fetchDeflatedBytes`); the input is not kept. */
export function inflateBytes(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const slice = workSlice(WORK_SLICE_MS, pageScope);
  return inflateDeflatedBytes(bytes, slice.check);
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
  const slice = workSlice(WORK_SLICE_MS, pageScope);
  return decodeDeflatedLanes(bytes, slice.check);
}
async function restoreLaneBytes(lanes: Uint8Array): Promise<Uint8Array> {
  const out = new Uint8Array(lanes.length), slice = workSlice(WORK_SLICE_MS, pageScope), words = lanes.length / 4;
  for (let start = 0; start < words; start += 16_384) {
    await slice.check();
    unshuffleLanes(lanes, out, start, Math.min(words, start + 16_384));
  }
  return out;
}

/**
 * meta IPHONE13-REAL-TEST IP31 (mini-nine-loadgc): a held file's bytes lent to the one page read that asks for them.
 * The spawn store answered a read of a stored file with `new Response(bytes)` (the Response copies them) and the reader
 * (`contentRead`) streamed that copy into a third buffer of the file's length. WebKit's collector often runs no full
 * collection inside a loading step, so all three stay in the page at once: on Nine's phone boot ~53 MB of held files
 * became ~160 MB by `readyFrame`. Lent, the Response carries the bytes themselves and the reader takes them whole.
 * The device slot `debug.loadGc` (true or false) picks it; a harness sets it before the boot.
 */
import { jsonSlot } from '../saves/slots';

export const LOAD_GC_SLOT = 'debug.loadGc';
let on: boolean | undefined;
/** IP31's switch, read once per page. */
export function loadGc(): boolean {
  if (on !== undefined) return on;
  try { on = jsonSlot(LOAD_GC_SLOT, 'device').read() === true; } catch { on = false; }
  return on;
}

const lent = new WeakMap<Response, Uint8Array<ArrayBuffer>>();
/** A Response whose body is `bytes` themselves: a stream that hands them over once, and the bytes kept for `takeLentBody`. */
export function lentResponse(bytes: Uint8Array<ArrayBuffer>, type: string): Response {
  const response = new Response(new ReadableStream<Uint8Array<ArrayBuffer>>({ pull: controller => { controller.enqueue(bytes); controller.close(); } }),
    { status: 200, headers: { 'content-type': type, 'content-length': String(bytes.byteLength) } });
  lent.set(response, bytes);
  return response;
}
/** The bytes lent with `response`, once (the caller now owns them), else undefined. */
export function takeLentBody(response: Response): Uint8Array<ArrayBuffer> | undefined {
  const bytes = lent.get(response); lent.delete(response); return bytes;
}

/**
 * MG10 (mini-ninesteady4, 2026-11-18): three-byte vertex channels go to the GPU at a four-byte stride.
 *
 * Metal reads a vertex attribute only at a stride (and offset) that is a multiple of 4 bytes. A tightly packed
 * three-component byte channel (Int8 or Uint8, itemSize 3: a quantized GLB's normals and colours, stride 3) is legal
 * WebGL, so ANGLE keeps the buffer as given and builds a stride-4 copy of it beside it for every draw: the GPU process
 * holds both. A blank WebKit page, 4 M vertices: the stride-3 channel holds 28.1 MB of IOAccelerator (its 12 MB plus a
 * 16 MB converted copy), the same channel padded to stride 4 holds 16 MB. Nine's slab architecture uploads 7.1 MB of such
 * normals and colours.
 *
 * `markByteTriples` names an array that three will upload as a plain itemSize-3 byte attribute; on WebKit the context's
 * `bufferData` then uploads it padded to four bytes a vertex (the fourth byte is 0, never read: the attribute stays
 * three components), and `vertexAttribPointer` reads that buffer at stride 4. Nothing above the GL calls changes: the
 * attribute keeps its tight array, count and item size, so CPU readers (the far levels' colour kinds, picking) see the
 * same bytes. A sub-range write is padded the same way, and a read back (`getBufferSubData`, the Memory saver's
 * `restore`) comes back tight. Install it before the Memory saver's upload watch (`memorySaver.ts` `watchUploads`
 * maps the attribute's own array to its buffer) and after the ledger's counters (they count the padded bytes the GPU holds).
 */
import { webKitEngine } from './drawHooks';
import { ownedArray } from '../../../shared/engine/core/ownedBuffer';

/** the transient padded copies (upload and read-back staging) */
const STAGING = { owner: 'engine/byte-triples', kind: 'scratch' } as const;

const ARRAY_BUFFER = 0x8892;
const BYTE = 0x1400, UNSIGNED_BYTE = 0x1401;

/** arrays three uploads as a tight three-component byte attribute */
const triples = new WeakSet<Int8Array | Uint8Array>();

/** Upload `array` (a plain itemSize-3 Int8 or Uint8 attribute's own array, nothing else viewing it as another layout)
 *  at a four-byte stride. Returns whether it qualified. */
export function markByteTriples(array: unknown): boolean {
  if (!(array instanceof Int8Array || array instanceof Uint8Array) || array.length === 0 || array.length % 3 !== 0) return false;
  triples.add(array);
  return true;
}

/** `vertices` triples of `source` (from vertex `from`) at four bytes a vertex: the fourth byte 0 */
export function padTriples(source: Int8Array | Uint8Array, from = 0, vertices: number = (source.length / 3) - from): Uint8Array {
  const bytes = new Uint8Array(source.buffer, source.byteOffset + from * 3, vertices * 3), out = ownedArray(Uint8Array, vertices * 4, STAGING);
  for (let v = 0, i = 0, o = 0; v < vertices; v++, i += 3, o += 4) { out[o] = bytes[i] ?? 0; out[o + 1] = bytes[i + 1] ?? 0; out[o + 2] = bytes[i + 2] ?? 0; }
  return out;
}

/** four bytes a vertex back to three, into `into` */
export function unpadTriples(padded: Uint8Array, into: Uint8Array): void {
  const vertices = into.length / 3;
  for (let v = 0, i = 0, o = 0; v < vertices; v++, i += 3, o += 4) { into[i] = padded[o] ?? 0; into[i + 1] = padded[o + 1] ?? 0; into[i + 2] = padded[o + 2] ?? 0; }
}

/** The calls `installByteTriples` wraps (a WebGL2 context; any function shape, each is called with GL's own arguments). */
export interface ByteTriplesContext {
  bindBuffer: (...args: never[]) => unknown;
  deleteBuffer: (...args: never[]) => unknown;
  bufferData: (...args: never[]) => unknown;
  bufferSubData: (...args: never[]) => unknown;
  getBufferSubData: (...args: never[]) => unknown;
  vertexAttribPointer: (...args: never[]) => unknown;
  vertexAttribIPointer: (...args: never[]) => unknown;
}

/** a byte view of an ArrayBufferView argument, or null */
const byteView = (data: unknown): Uint8Array | null => ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;

/** Wrap `gl` so marked arrays upload at stride 4 (WebKit only). False: not installed. */
export function installByteTriples(gl: ByteTriplesContext, userAgent: string = globalThis.navigator?.userAgent ?? ''): boolean {
  if (!webKitEngine(userAgent)) return false;
  const padded = new WeakSet(), bound = new Map<number, unknown>();
  const call = (name: keyof ByteTriplesContext): ((...args: readonly unknown[]) => void) => { const f: unknown = gl[name]; return (...args) => { Reflect.apply(f as (...a: unknown[]) => unknown, gl, args); }; };
  const wrap = (name: keyof ByteTriplesContext, value: (...args: readonly unknown[]) => void): void => { Object.defineProperty(gl, name, { value, writable: true, configurable: true }); };
  const bindBuffer = call('bindBuffer'), deleteBuffer = call('deleteBuffer'), bufferData = call('bufferData'), bufferSubData = call('bufferSubData');
  const getBufferSubData = call('getBufferSubData'), pointer = call('vertexAttribPointer'), iPointer = call('vertexAttribIPointer');
  const paddedAt = (target: number): boolean => { const b = bound.get(target); return typeof b === 'object' && b !== null && padded.has(b); };
  wrap('bindBuffer', (...args) => { const [target, buffer] = args; if (typeof target === 'number') bound.set(target, buffer); bindBuffer(...args); });
  // a deleted buffer is unbound from every target it was bound to
  wrap('deleteBuffer', (...args) => { for (const [target, b] of bound) if (b === args[0]) bound.set(target, null); deleteBuffer(...args); });
  wrap('bufferData', (...args) => {
    const [target, data, usage] = args, buffer = typeof target === 'number' ? bound.get(target) : undefined;
    if (typeof buffer === 'object' && buffer !== null) {
      // whatever this buffer held, it now holds what this call uploads
      if (target === ARRAY_BUFFER && args.length === 3 && (data instanceof Int8Array || data instanceof Uint8Array) && triples.has(data)) {
        padded.add(buffer); bufferData(target, padTriples(data), usage); return;
      }
      padded.delete(buffer);
    }
    bufferData(...args);
  });
  /** the bytes an ArrayBufferView argument names from element `start` (`count` elements, 0 or absent: to its end) */
  const span = (data: unknown, start: unknown, count: unknown): { view: Uint8Array; at: number; bytes: number } | null => {
    const view = byteView(data);
    if (view === null || !ArrayBuffer.isView(data)) return null;
    const size = 'BYTES_PER_ELEMENT' in data && typeof data.BYTES_PER_ELEMENT === 'number' ? data.BYTES_PER_ELEMENT : 1, at = (typeof start === 'number' ? start : 0) * size;
    return { view, at, bytes: typeof count === 'number' && count > 0 ? count * size : view.length - at };
  };
  wrap('bufferSubData', (...args) => {
    const [target, offset, data, srcOffset, length] = args;
    if (typeof target === 'number' && typeof offset === 'number' && paddedAt(target)) {
      const s = span(data, srcOffset, length);
      if (s === null || offset % 3 !== 0 || s.at % 3 !== 0 || s.bytes % 3 !== 0 || s.bytes < 0) throw new Error('byteTriples: a write into a padded buffer off its vertex boundaries');
      bufferSubData(target, (offset / 3) * 4, padTriples(s.view, s.at / 3, s.bytes / 3));
      return;
    }
    bufferSubData(...args);
  });
  wrap('getBufferSubData', (...args) => {
    const [target, offset, data, dstOffset, length] = args;
    if (typeof target === 'number' && typeof offset === 'number' && paddedAt(target)) {
      const s = span(data, dstOffset, length);
      if (s === null || offset % 3 !== 0 || s.bytes % 3 !== 0 || s.bytes < 0) throw new Error('byteTriples: a read from a padded buffer off its vertex boundaries');
      const wide = ownedArray(Uint8Array, (s.bytes / 3) * 4, STAGING);
      getBufferSubData(target, (offset / 3) * 4, wide);
      unpadTriples(wide, s.view.subarray(s.at, s.at + s.bytes));
      return;
    }
    getBufferSubData(...args);
  });
  // a three-byte channel at its tight stride (0 or 3) from a padded buffer reads at 4
  const stride = (size: unknown, type: unknown, given: unknown, offset: unknown): unknown =>
    paddedAt(ARRAY_BUFFER) && size === 3 && (type === BYTE || type === UNSIGNED_BYTE) && (given === 0 || given === 3) && offset === 0 ? 4 : given;
  wrap('vertexAttribPointer', (...args) => { const [index, size, type, normalized, given, offset] = args; pointer(index, size, type, normalized, stride(size, type, given, offset), offset); });
  wrap('vertexAttribIPointer', (...args) => { const [index, size, type, given, offset] = args; iPointer(index, size, type, stride(size, type, given, offset), offset); });
  return true;
}

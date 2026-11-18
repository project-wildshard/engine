import { memoryAttribution } from './memoryAttribution';

/** ENGINE-MEMORY EM6, design rule 1: one owner per buffer. Every ArrayBuffer of 64 KB or more the engine makes or keeps
 * goes through these helpers, which name its owner, asset and ledger kind, so the RAM ledger counts it once, from the
 * moment it exists until the owner lets go (`releaseOwned`) or it is collected. A second holder takes a view, never a
 * copy. Every buffer made here is counted, whatever its size: on Template most kept geometry arrays are under 64 KB (EM6's
 * census). These are for load-time and kept buffers; per-frame scratch comes from a pool (design rule 8).
 * `lint/owned-buffer.mjs` counts direct `new ArrayBuffer`, sized typed-array constructors and `.buffer.slice()` copies
 * outside this file against a ratchet; a literal length under OWNED_BUFFER_BYTES is not a site. */
export const OWNED_BUFFER_BYTES: number = 64 * 1024;

/** The ledger kinds of CPU buffers (EM8 weighs each kind; keep the list short). */
export type OwnedKind = 'array-buffer' | 'wire' | 'geometry-cpu' | 'decode' | 'audio-data' | 'physics' | 'scratch';
export interface OwnedLabel { readonly owner: string; readonly asset?: string; readonly kind?: OwnedKind }

type Typed = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
interface TypedConstructor<T extends Typed> { new (length: number): T; readonly BYTES_PER_ELEMENT: number }

function count(buffer: ArrayBufferLike, label: OwnedLabel): void {
  memoryAttribution.buffer(buffer, { owner: label.owner, asset: label.asset ?? label.owner }, label.kind ?? 'array-buffer');
}

/** A new zeroed ArrayBuffer, counted under its owner. */
export function ownedBuffer(bytes: number, label: OwnedLabel): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes);
  count(buffer, label); return buffer;
}

/** A new zeroed typed array of `length` elements, counted under its owner. */
export function ownedArray<T extends Typed>(Type: TypedConstructor<T>, length: number, label: OwnedLabel): T {
  const array = new Type(length);
  count(array.buffer, label); return array;
}

/** A copy of `view`'s elements in a buffer of its own (what `view.slice()` makes), counted under its owner. */
export function ownedCopy<T extends Typed>(view: T, label: OwnedLabel): ReturnType<T['slice']> {
  const copy = view.slice() as ReturnType<T['slice']>;
  count(copy.buffer, label); return copy;
}

/** Take ownership of a buffer something else made (a fetch, a decoder, a worker's transfer): counted under `label`
 * from now on. Returns its argument. */
export function adoptBuffer<T extends ArrayBufferView | ArrayBufferLike>(value: T, label: OwnedLabel): T {
  count(ArrayBuffer.isView(value) ? value.buffer : value, label); return value;
}

/** The owner lets go: the ledger drops the bytes now rather than at collection. Views of the buffer stay valid. */
export function releaseOwned(value: ArrayBufferView | ArrayBufferLike): void {
  memoryAttribution.release(ArrayBuffer.isView(value) ? value.buffer : value, 'ram');
}

/**
 * MEMORY-GATES MG10 (J410, mini-ninemem10): a hint that makes JavaScriptCore start a full collection now. JSC counts an
 * ArrayBuffer's length toward its next collection when the buffer is made, while the kernel charges a page only once it
 * is written; this buffer is never written, never counted in the ledger and dropped at once. Nine's WebKit loading peak
 * is the heap's high-water when its first full collection after the `props` step runs: left alone that waits for the
 * `readyFrame` burst or control, when hundreds of MB of boot garbage sit beside a grown world (mini-ninemem9). Hinted as
 * the shaders step starts, the collection lands earlier: Nine, 10 alternating cold WebKit pairs, peak 1,192 -> 1,119 MB [K],
 * settled 752 -> 741; Simulator loading 0.85 -> 0.77 GB native. 96 MB triggers nothing: the length is the trigger. A host
 * that refuses the reservation gets no hint. Returns the bytes asked.
 */
export const COLLECTION_HINT_BYTES: number = 256 * 1024 * 1024;
let hinted = 0;
export function hintCollection(bytes: number = COLLECTION_HINT_BYTES): number {
  try { hinted = new ArrayBuffer(bytes).byteLength; } catch { hinted = 0; }
  return hinted;
}

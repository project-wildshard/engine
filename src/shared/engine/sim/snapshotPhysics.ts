/** Internal snapshot byte bounds; compression never changes or omits native world data. */
export const MAX_PHYSICS_BYTES = 32_000_000;
/** Worst-case literal framing overhead, even when a match splits every 64 bytes. */
export const MAX_REFERENCE_BYTES: number = MAX_PHYSICS_BYTES + Math.ceil(MAX_PHYSICS_BYTES / 64) * 3 + 16;
const literalLimit = 65_536, matchMinimum = 64;

// Long-range matches cover repeated native geometry/BVHs outside DEFLATE's 32 KiB window.
// All decisions affect compression ratio only; full bytes and lengths remain authoritative.
function hash(view: DataView, at: number): number {
  // Every indexed start has at least sixteen bytes. Read the same little-endian words directly;
  // a per-byte load/loop dominated synchronous crossing checkpoints on the desktop trace.
  let value = Math.imul(2166136261 ^ view.getUint32(at, true), 16777619);
  value = Math.imul(value ^ view.getUint32(at + 4, true), 16777619);
  value = Math.imul(value ^ view.getUint32(at + 8, true), 16777619);
  value = Math.imul(value ^ view.getUint32(at + 12, true), 16777619);
  return (value >>> 0) & 0xfffff;
}
function hashWords(a: number, b: number, c: number, d: number): number {
  let value = Math.imul(2166136261 ^ a, 16777619);
  value = Math.imul(value ^ b, 16777619);
  value = Math.imul(value ^ c, 16777619);
  value = Math.imul(value ^ d, 16777619);
  return (value >>> 0) & 0xfffff;
}
// Four consecutive starts share five little-endian word loads. Keep every
// position and write order, including collisions. The caller leaves at least
// 64 bytes after the run, so the grouped window stays inside the input.
function indexMatch(view: DataView, dictionary: Int32Array, start: number, end: number): void {
  let i = start;
  for (; i + 3 < end; i += 4) {
    const a = view.getUint32(i, true), b = view.getUint32(i + 4, true), c = view.getUint32(i + 8, true), d = view.getUint32(i + 12, true), e = view.getUint32(i + 16, true);
    dictionary[hashWords(a, b, c, d)] = i;
    dictionary[hashWords((a >>> 8) | (b << 24), (b >>> 8) | (c << 24), (c >>> 8) | (d << 24), (d >>> 8) | (e << 24))] = i + 1;
    dictionary[hashWords((a >>> 16) | (b << 16), (b >>> 16) | (c << 16), (c >>> 16) | (d << 16), (d >>> 16) | (e << 16))] = i + 2;
    dictionary[hashWords((a >>> 24) | (b << 8), (b >>> 24) | (c << 8), (c >>> 24) | (d << 8), (d >>> 24) | (e << 8))] = i + 3;
  }
  for (; i < end; i++) dictionary[hash(view, i)] = i;
}
// Only matches of at least 64 bytes can emit a reference. Reject shorter
// candidates before extending their prefix; qualifying lengths stay exact.
function matchedBytes(left: DataView, leftAt: number, right: DataView, rightAt: number): number {
  const limit = Math.min(left.byteLength - leftAt, right.byteLength - rightAt);
  if (limit < matchMinimum
    || left.getUint32(leftAt + 60, true) !== right.getUint32(rightAt + 60, true)
    || left.getUint32(leftAt + 48, true) !== right.getUint32(rightAt + 48, true)
    || left.getUint32(leftAt + 32, true) !== right.getUint32(rightAt + 32, true)
    || left.getUint32(leftAt + 16, true) !== right.getUint32(rightAt + 16, true)) return 0;
  for (let offset = 0; offset < matchMinimum; offset += 4) {
    if (offset === 16 || offset === 32 || offset === 48 || offset === 60) continue;
    if (left.getUint32(leftAt + offset, true) !== right.getUint32(rightAt + offset, true)) return 0;
  }
  let length = matchMinimum;
  while (length + 16 <= limit
    && left.getUint32(leftAt + length, true) === right.getUint32(rightAt + length, true)
    && left.getUint32(leftAt + length + 4, true) === right.getUint32(rightAt + length + 4, true)
    && left.getUint32(leftAt + length + 8, true) === right.getUint32(rightAt + length + 8, true)
    && left.getUint32(leftAt + length + 12, true) === right.getUint32(rightAt + length + 12, true)) length += 16;
  while (length + 4 <= limit && left.getUint32(leftAt + length, true) === right.getUint32(rightAt + length, true)) length += 4;
  while (length < limit && left.getUint8(leftAt + length) === right.getUint8(rightAt + length)) length++;
  return length;
}
// rt3-freeze: a regional autosave once hashed every basis position and every byte inside each match (~1 M 16-byte
// hashes for a 440 KB template world). The basis is indexed every 16 bytes (a 64-byte match always spans an indexed
// start, so at most 15 more literal bytes begin it), and bytes copied from the basis are not re-indexed (the basis
// holds them already). Compression ratio may move slightly; decoding and the exact bytes never change.
const basisStride = 16;
/** Native bytes as the snapshot's plain JSON array: an indexed copy, ~10x faster than Array.from's iterator on a phone (rt3-freeze). */
export function byteArray(bytes: Uint8Array): number[] {
  // oxlint-disable-next-line unicorn/no-new-array -- Typed numeric byte length; direct sizing avoids JSC backing-store growth (~4x copy kernel).
  const array = new Array<number>(bytes.length);
  for (let index = 0; index < bytes.length; index++) array[index] = bytes[index] ?? 0;
  return array;
}
/** Lossless literal/copy framing with bounded dictionaries; a basis is immutable, freshly admitted world data. */
export function encodePhysicsReferences(bytes: Uint8Array, basis?: Uint8Array): Uint8Array {
  if (bytes.length === 0 || bytes.length > MAX_PHYSICS_BYTES) throw new RangeError('Snapshot physics exceeds byte bounds');
  if (basis !== undefined && (basis.length === 0 || basis.length > MAX_PHYSICS_BYTES)) throw new RangeError('Snapshot physics basis exceeds byte bounds');
  const encoded = new Uint8Array(bytes.length + Math.ceil(bytes.length / matchMinimum) * 3 + 16), view = new DataView(encoded.buffer);
  const rawView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const basisView = basis === undefined ? undefined : new DataView(basis.buffer, basis.byteOffset, basis.byteLength);
  const dictionary = new Int32Array(0x100000).fill(-1);
  const basisDictionary = basis === undefined ? undefined : new Int32Array(0x100000).fill(-1);
  if (basisView !== undefined && basisDictionary !== undefined) for (let i = 0; i + matchMinimum <= basisView.byteLength; i += basisStride) basisDictionary[hash(basisView, i)] = i;
  let written = 0, literal = 0, at = 0;
  const flush = (end: number): void => {
    while (literal < end) {
      const length = Math.min(literalLimit, end - literal);
      encoded[written++] = 0; view.setUint16(written, length - 1, true); written += 2;
      encoded.set(bytes.subarray(literal, literal + length), written); written += length; literal += length;
    }
  };
  while (at + matchMinimum <= bytes.length) {
    const key = hash(rawView, at), previous = dictionary[key] ?? -1; dictionary[key] = at;
    let length = previous < 0 ? 0 : matchedBytes(rawView, previous, rawView, at);
    const basisAt = basisDictionary?.[key] ?? -1;
    const basisLength = basisView === undefined || basisAt < 0 ? 0 : matchedBytes(basisView, basisAt, rawView, at);
    const external = basisLength >= matchMinimum && basisLength >= length;
    if (external) length = basisLength;
    if (length < matchMinimum) { at++; continue; }
    flush(at);
    encoded[written++] = external ? 2 : 1; view.setUint32(written, external ? basisAt : at - previous, true); written += 4; view.setUint32(written, length, true); written += 4;
    // No future search can observe dictionary writes after the final match.
    if (!external && at + length + matchMinimum <= bytes.length) indexMatch(rawView, dictionary, at + 1, at + length);
    at += length; literal = at;
  }
  flush(bytes.length);
  return encoded.subarray(0, written);
}
/** Reject malformed references before copying; output allocation and total reconstructed work are bounded by length. */
function references(bytes: Uint8Array, length: number, basisLength: number | undefined, result?: Uint8Array, basis?: Uint8Array): void {
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_PHYSICS_BYTES || bytes.length > MAX_REFERENCE_BYTES) throw new RangeError('Snapshot physics exceeds byte bounds');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0, written = 0;
  while (at < bytes.length) {
    const kind = bytes[at++];
    if (kind === 0) {
      if (at + 2 > bytes.length) throw new RangeError('Truncated snapshot physics literal');
      const count = view.getUint16(at, true) + 1; at += 2;
      if (at + count > bytes.length || written + count > length) throw new RangeError('Invalid snapshot physics literal length');
      result?.set(bytes.subarray(at, at + count), written); at += count; written += count;
    } else if (kind === 1 || kind === 2) {
      if (at + 8 > bytes.length) throw new RangeError('Truncated snapshot physics reference');
      const distance = view.getUint32(at, true), count = view.getUint32(at + 4, true); at += 8;
      if (kind === 2) {
        if (basisLength === undefined || count < matchMinimum || distance + count > basisLength || written + count > length) throw new RangeError('Invalid snapshot physics basis reference');
        if (result !== undefined && basis !== undefined) result.set(basis.subarray(distance, distance + count), written);
        written += count; continue;
      }
      if (distance < 1 || distance > written || count < matchMinimum || written + count > length) throw new RangeError('Invalid snapshot physics reference');
      const end = written + count;
      if (result === undefined) written = end;
      else while (written < end) { result[written] = result[written - distance] ?? 0; written++; }
    } else throw new RangeError('Unknown snapshot physics token');
  }
  if (written !== length) throw new RangeError('Snapshot physics decoded length mismatch');
}
/** Validate all literal/copy bounds against the declared old basis without replaying unknown bytes. This is not an integrity proof. */
export function validatePhysicsReferences(bytes: Uint8Array, length: number, basisLength?: number): void {
  references(bytes, length, basisLength);
}
/** Reconstruct exact bytes only with the caller's checked basis. */
export function decodePhysicsReferences(bytes: Uint8Array, length: number, basis?: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_PHYSICS_BYTES || bytes.length > MAX_REFERENCE_BYTES) throw new RangeError('Snapshot physics exceeds byte bounds');
  const result = new Uint8Array(length);
  references(bytes, length, basis?.length, result, basis);
  return result;
}

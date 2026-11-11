import { MAX_PHYSICS_BYTES, encodePhysicsReferences, physicsEncoderParts } from './snapshotPhysics';

// TEST-SPEED TS4a (J255/J256): a headless world checkpoints the same native world again and again, and between two
// checkpoints only a few stretches of its 22 MB change: a few hundred bytes to ~150 KB near the start, a little at the
// end, and the stretch between them may move by a few hundred bytes. This memo re-encodes only around those stretches and
// reuses the previous checkpoint's references everywhere else. Its output is byte-for-byte encodePhysicsReferences(bytes)
// (test/snapshot-reference-memo.test.ts fuzzes it against the encoder); any doubt falls back to the full encoder.
//
// Why it is exact, for a basis-free encoding:
// - The dictionary at a decision point maps each hash to the largest earlier position with that hash: every scanned
//   position is written once, in order (a literal step writes its own position; a match indexes all of its positions).
//   So it is a function of the bytes alone, not of the path the encoder took.
// - The new bytes are the old ones with some windows replaced: between windows, a stretch is an exact copy, shifted by
//   its own delta. Positions there keep their hashes and their order, so a hash whose every occurrence lies in copied
//   stretches finds the shifted copy of the same earlier position. Only a hash that some position in a window, or up to
//   80 bytes before one, has in either run ("tainted") can find a different one, and only until it next occurs.
// - So from a point where both runs stand right after the same match, each later decision is the previous run's,
//   unless (1) it looks up a tainted hash at its first recurrence, or (2) its source bytes reach into a window. Both are
//   recomputed and must agree. A reused match keeps its length; its distance moves by the difference between the deltas
//   of its target's and its source's stretches, and is patched in place.

const { hash, hashWords, indexMatch, matchedBytes, matchMinimum, literalLimit } = physicsEncoderParts;
/** Before a window: a candidate this far back can reach changed bytes with its 64-byte check, and so can a 16-byte hash. */
const lead = matchMinimum + 16;
/** The memo gives up (full encoder) past this many changed bytes or windows, or when a copy doesn't resume within
 * `resyncSpan` bytes, at a shift of up to `resyncShift`. */
const maxWindowBytes = 4 << 20, maxWindows = 64, resyncSpan = 1 << 19, resyncShift = 1 << 14;
/** A copied stretch is accepted once this many bytes agree at the new delta. */
const resyncBytes = 256;

/** One world's previous encoding: its bytes, its references and its matches as [at, distance, length, output end].
 * Opaque to callers: pass it back unchanged. */
export interface PhysicsReferenceMemo { readonly raw: Uint8Array; readonly encoded: Uint8Array; readonly matches: Int32Array }

/** A replaced stretch: old [from0, to0) became new [from1, to1); the copied stretch after it has delta = to1 - to0. */
interface Window { readonly from0: number; readonly to0: number; readonly from1: number; readonly to1: number }

/** encodePhysicsReferences without a basis, as a resumable machine that records its matches. Keep its step the same. */
class Encoder {
  readonly encoded: Uint8Array;
  readonly view: DataView;
  readonly raw: DataView;
  readonly dictionary = new Int32Array(0x100000).fill(-1);
  matches: number[] = [];
  written = 0;
  literal = 0;
  at = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.encoded = new Uint8Array(bytes.length + Math.ceil(bytes.length / matchMinimum) * 3 + 16);
    this.view = new DataView(this.encoded.buffer);
    this.raw = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  private flush(end: number): void {
    const { bytes, encoded, view } = this;
    while (this.literal < end) {
      const length = Math.min(literalLimit, end - this.literal);
      encoded[this.written++] = 0; view.setUint16(this.written, length - 1, true); this.written += 2;
      encoded.set(bytes.subarray(this.literal, this.literal + length), this.written); this.written += length; this.literal += length;
    }
  }
  /** Encode until a match ends where `stop` says, or to the end (true only when stopped). */
  run(stop: (at: number) => boolean): boolean {
    const { bytes, dictionary, raw, encoded, view } = this;
    while (this.at + matchMinimum <= bytes.length) {
      const at = this.at, key = hash(raw, at), previous = dictionary[key] ?? -1; dictionary[key] = at;
      const length = previous < 0 ? 0 : matchedBytes(raw, previous, raw, at, bytes.length - at);
      if (length < matchMinimum) { this.at++; continue; }
      this.flush(at);
      encoded[this.written++] = 1; view.setUint32(this.written, at - previous, true); this.written += 4; view.setUint32(this.written, length, true); this.written += 4;
      if (at + length + matchMinimum <= bytes.length) indexMatch(raw, dictionary, at + 1, at + length);
      this.matches.push(at, at - previous, length, this.written);
      this.at = at + length; this.literal = this.at;
      if (stop(this.at)) return true;
    }
    this.flush(bytes.length);
    return false;
  }
}

function fullMemo(bytes: Uint8Array): PhysicsReferenceMemo {
  const encoder = new Encoder(bytes);
  encoder.run(() => false);
  return { raw: Uint8Array.from(bytes), encoded: encoder.encoded.slice(0, encoder.written), matches: Int32Array.from(encoder.matches) };
}

/** First position from `at1` where new[at1] differs from old[at1 - delta], or the first end reached. */
function firstDifference(oldBytes: Uint8Array, newBytes: Uint8Array, at1: number, delta: number): number {
  const end = Math.min(newBytes.length, oldBytes.length + delta);
  let at = at1;
  const oldView = new DataView(oldBytes.buffer, oldBytes.byteOffset, oldBytes.byteLength), newView = new DataView(newBytes.buffer, newBytes.byteOffset, newBytes.byteLength);
  while (at + 4 <= end && newView.getUint32(at, true) === oldView.getUint32(at - delta, true)) at += 4;
  while (at < end && newBytes[at] === oldBytes[at - delta]) at++;
  return at;
}
/** The nearest old position to `center` (within `radius`) whose 64 bytes equal new[at1, at1 + 64), or -1. */
function findBlock(oldBytes: Uint8Array, newBytes: Uint8Array, at1: number, center: number, radius: number): number {
  const oldView = new DataView(oldBytes.buffer, oldBytes.byteOffset, oldBytes.byteLength);
  const word = new DataView(newBytes.buffer, newBytes.byteOffset, newBytes.byteLength).getInt32(at1, true);
  for (let step = 0; step <= radius; step++) {
    for (const candidate of step === 0 ? [center] : [center - step, center + step]) {
      if (candidate < 0 || candidate + matchMinimum > oldBytes.length || oldView.getInt32(candidate, true) !== word) continue;
      let same = 4;
      while (same < matchMinimum && oldBytes[candidate + same] === newBytes[at1 + same]) same++;
      if (same === matchMinimum) return candidate;
    }
  }
  return -1;
}
/** The changed windows, in order, or null when the change is too big or too scattered for the memo. */
function changedWindows(oldBytes: Uint8Array, newBytes: Uint8Array): Window[] | null {
  const windows: Window[] = [];
  let delta = 0, at1 = 0, changed = 0;
  for (;;) {
    at1 = firstDifference(oldBytes, newBytes, at1, delta);
    if (at1 >= newBytes.length && at1 - delta >= oldBytes.length) return windows;
    if (windows.length >= maxWindows) return null;
    let resync = -1, next = delta;
    if (at1 < newBytes.length && at1 - delta < oldBytes.length) {
      for (let probe = at1 + matchMinimum; probe + resyncBytes <= newBytes.length && probe - at1 <= resyncSpan; probe += 2048) {
        const found = findBlock(oldBytes, newBytes, probe, probe - delta, resyncShift);
        if (found < 0 || firstDifference(oldBytes, newBytes, probe, probe - found) - probe < resyncBytes) continue;
        next = probe - found; resync = probe;
        // Back to where the copy at the new delta starts, keeping both sides of the window in order.
        while (resync > at1 && resync - 1 - next >= at1 - delta && newBytes[resync - 1] === oldBytes[resync - 1 - next]) resync--;
        resync = Math.max(resync, at1, at1 + next - delta);
        break;
      }
    }
    if (resync < 0) { windows.push({ from0: at1 - delta, to0: oldBytes.length, from1: Math.min(at1, newBytes.length), to1: newBytes.length }); return windows; }
    const window = { from0: at1 - delta, to0: resync - next, from1: at1, to1: resync };
    changed += window.to1 - window.from1 + window.to0 - window.from0;
    if (changed > maxWindowBytes) return null;
    windows.push(window); delta = next; at1 = resync;
  }
}

/** The memo's encoding of `bytes` (exactly encodePhysicsReferences(bytes)), and the memo for the next call. */
export function encodePhysicsReferencesMemo(bytes: Uint8Array, memo?: PhysicsReferenceMemo): { readonly encoded: Uint8Array; readonly memo: PhysicsReferenceMemo } {
  if (bytes.length === 0 || bytes.length > MAX_PHYSICS_BYTES) return { encoded: encodePhysicsReferences(bytes), memo: memo ?? fullMemo(bytes) };
  const next = (memo === undefined ? null : splice(bytes, memo)) ?? fullMemo(bytes);
  // The memo keeps a compact copy no caller holds: the caller gets its own, so writing to it can't change a later result.
  return { encoded: next.encoded.slice(), memo: next };
}

function splice(bytes: Uint8Array, memo: PhysicsReferenceMemo): PhysicsReferenceMemo | null {
  const oldBytes = memo.raw, n1 = bytes.length, n0 = oldBytes.length;
  if (n0 < 2 * lead || n1 < 2 * lead) return null;
  const windows = changedWindows(oldBytes, bytes);
  if (windows === null) return null;
  if (windows.length === 0) return memo;
  const old = memo.matches, count = old.length / 4;
  const oldAt = (index: number): number => old[index * 4] ?? 0, oldEnd = (index: number): number => (old[index * 4] ?? 0) + (old[index * 4 + 2] ?? 0);
  /** The old match ending exactly at `end`, or -1 (ends increase with the index). */
  const endingAt = (end: number): number => {
    let low = 0, high = count - 1;
    while (low <= high) { const middle = (low + high) >>> 1, value = oldEnd(middle); if (value === end) return middle; if (value < end) low = middle + 1; else high = middle - 1; }
    return -1;
  };
  /** Delta of the copied stretch holding old position q, or NaN inside a window. */
  const deltaAt = (q: number): number => {
    let delta = 0;
    for (const window of windows) {
      if (q < window.from0) return delta;
      if (q < window.to0) return Number.NaN;
      delta = window.to1 - window.to0;
    }
    return delta;
  };
  /** Do old bytes [from, to) reach into a window? An empty old side counts when the span crosses its boundary. */
  const touches = (from: number, to: number): boolean => windows.some(window => from < Math.max(window.to0, window.from0) && to > window.from0);
  const encoder = new Encoder(bytes), view = encoder.raw, oldView = new DataView(oldBytes.buffer, oldBytes.byteOffset, oldBytes.byteLength);
  const tainted = new Uint8Array(0x100000);
  let remaining = 0;
  const mark = (key: number): void => { if (tainted[key] === 0) { tainted[key] = 1; remaining++; } };
  const taint = (window: Window): void => {
    for (let at = Math.max(0, window.from0 - lead); at < Math.max(window.to0, window.from0) && at + matchMinimum <= n0; at++) mark(hash(oldView, at));
    for (let at = Math.max(0, window.from1 - lead); at < Math.max(window.to1, window.from1) && at + matchMinimum <= n1; at++) mark(hash(view, at));
  };
  let current = 0;
  const first = windows[0];
  if (first === undefined) return memo;
  taint(first);
  for (;;) {
    // Re-encode through the current window until a match ends where an old one ended, clear of the next window's lead;
    // a next window reached first joins the current one.
    let joined = -1;
    const stopped = encoder.run(at => {
      for (;;) {
        const after = windows[current + 1];
        if (after !== undefined && at + lead >= after.from1) { current++; taint(after); continue; }
        const window = windows[current];
        if (window === undefined || at <= window.to1 + lead) return false;
        joined = endingAt(at - (window.to1 - window.to0));
        return joined >= 0;
      }
    });
    if (!stopped) return finish(encoder);
    const window = windows[current];
    if (window === undefined) return null;
    const delta = window.to1 - window.to0, after = windows[current + 1];
    const sync0 = encoder.at - delta;
    // The end of the copied stretch to reuse: the last old match end clear of the next window's lead (or the end).
    let last = count - 1;
    if (after !== undefined) {
      last = joined;
      while (last + 1 < count && oldEnd(last + 1) + lead < after.from0) last++;
      if (last === joined) { current++; taint(after); continue; }
    }
    const until0 = after === undefined ? n0 : oldEnd(last);
    // (1) Every position of the stretch: keep the dictionary exact (not needed past the last window), and redo a tainted
    // hash's lookup at its first recurrence; the old decision there (a literal, or the same match) must come out again.
    let index = joined + 1;
    const recheck = (at0: number, key: number): boolean => {
      tainted[key] = 0; remaining--;
      while (index < count && oldEnd(index) <= at0) index++;
      const start = index < count ? oldAt(index) : n0;
      if (start < at0) return true;
      const at1 = at0 + delta, candidate = encoder.dictionary[key] ?? -1, length = candidate < 0 ? 0 : matchedBytes(view, candidate, view, at1, n1 - at1);
      if (start > at0) return length < matchMinimum;
      const source0 = at0 - (old[index * 4 + 1] ?? 0), shift = deltaAt(source0);
      return !Number.isNaN(shift) && candidate === source0 + shift && length === (old[index * 4 + 2] ?? 0);
    };
    const end0 = Math.min(until0, n0 - matchMinimum + 1), dictionary = encoder.dictionary, keep = after !== undefined;
    let at0 = sync0;
    // Four positions' hashes from five word loads, as indexMatch does: the same keys hash() gives, in the same order.
    for (; at0 + 3 < end0; at0 += 4) {
      if (!keep && remaining === 0) break;
      const at1 = at0 + delta, a = view.getUint32(at1, true), b = view.getUint32(at1 + 4, true), c = view.getUint32(at1 + 8, true), d = view.getUint32(at1 + 12, true), e = view.getUint32(at1 + 16, true);
      const k0 = hashWords(a, b, c, d), k1 = hashWords((a >>> 8) | (b << 24), (b >>> 8) | (c << 24), (c >>> 8) | (d << 24), (d >>> 8) | (e << 24));
      const k2 = hashWords((a >>> 16) | (b << 16), (b >>> 16) | (c << 16), (c >>> 16) | (d << 16), (d >>> 16) | (e << 16));
      const k3 = hashWords((a >>> 24) | (b << 8), (b >>> 24) | (c << 8), (c >>> 24) | (d << 8), (d >>> 24) | (e << 8));
      if (tainted[k0] === 1 && !recheck(at0, k0)) return null;
      if (keep) dictionary[k0] = at1;
      if (tainted[k1] === 1 && !recheck(at0 + 1, k1)) return null;
      if (keep) dictionary[k1] = at1 + 1;
      if (tainted[k2] === 1 && !recheck(at0 + 2, k2)) return null;
      if (keep) dictionary[k2] = at1 + 2;
      if (tainted[k3] === 1 && !recheck(at0 + 3, k3)) return null;
      if (keep) dictionary[k3] = at1 + 3;
    }
    for (; at0 < end0; at0++) {
      if (!keep && remaining === 0) break;
      const key = hash(view, at0 + delta);
      if (tainted[key] === 1 && !recheck(at0, key)) return null;
      if (keep) dictionary[key] = at0 + delta;
    }
    // (2) The stretch's old matches: same length (rechecked where its source reaches a window), distance moved by the
    // difference between its target's and its source's deltas, patched in the copied output.
    const from = old[joined * 4 + 3] ?? 0, to = after === undefined ? memo.encoded.length : old[last * 4 + 3] ?? 0;
    const offset = encoder.written - from;
    encoder.encoded.set(memo.encoded.subarray(from, to), encoder.written);
    for (let reused = joined + 1; reused <= last; reused++) {
      const target0 = oldAt(reused), distance = old[reused * 4 + 1] ?? 0, length = old[reused * 4 + 2] ?? 0, source0 = target0 - distance;
      const shift = deltaAt(source0);
      if (Number.isNaN(shift)) return null;
      if (touches(source0, source0 + length + 16) && matchedBytes(view, source0 + shift, view, target0 + delta, n1 - target0 - delta) !== length) return null;
      const end = (old[reused * 4 + 3] ?? 0) + offset, moved = distance + delta - shift;
      if (moved !== distance) encoder.view.setUint32(end - 8, moved, true);
      encoder.matches.push(target0 + delta, moved, length, end);
    }
    encoder.written += to - from;
    if (after === undefined) return finish(encoder);
    encoder.at = encoder.literal = until0 + delta;
    current++; taint(after);
  }
}
function finish(encoder: Encoder): PhysicsReferenceMemo {
  return { raw: Uint8Array.from(encoder.bytes), encoded: encoder.encoded.slice(0, encoder.written), matches: Int32Array.from(encoder.matches) };
}

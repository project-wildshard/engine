import { expect, test } from 'vitest';
import { encodePhysicsReferences } from '../src/shared/engine/sim/snapshotPhysics';
import { encodePhysicsReferencesMemo, type PhysicsReferenceMemo } from '../src/shared/engine/sim/snapshotReferenceMemo';

// TEST-SPEED TS4a: the memo's references are byte-for-byte the full encoder's, across chains of checkpoints whose bytes
// change in several windows, grow, shrink and shift, at the start, the end and in between.
let seed = 0x5eed;
const random = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
const below = (n: number): number => Math.floor(random() * n);
/** Native-like bytes: repeated earlier spans (long matches), flat runs and noise. */
function world(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let at = 0; at < length;) {
    const kind = random(), span = 1 + below(400);
    if (kind < 0.45 && at > 300) { const source = below(at - 1); for (let index = 0; index < span && at < length; index++) bytes[at++] = bytes[source + index] ?? 0; }
    else if (kind < 0.7) { const value = below(3); for (let index = 0; index < span && at < length; index++) bytes[at++] = value; }
    else for (let index = 0; index < span && at < length; index++) bytes[at++] = below(256);
  }
  return bytes;
}
/** One to five edits: overwrite a stretch, insert, delete, or copy a stretch over another. */
function step(bytes: Uint8Array): Uint8Array {
  let out = bytes;
  for (let edit = 1 + below(5); edit > 0; edit--) {
    const n = out.length, at = random() < 0.15 ? below(200) : random() < 0.15 ? n - 1 - below(200) : below(n), kind = random();
    if (kind < 0.4) {
      const span = 1 + below(random() < 0.2 ? 3000 : 60);
      out = Uint8Array.from(out);
      for (let index = 0; index < span && at + index < n; index++) out[at + index] = random() < 0.5 ? below(256) : out[below(n)] ?? 0;
    } else if (kind < 0.7) {
      const length = 1 + below(random() < 0.2 ? 2000 : 80), copy = new Uint8Array(n + length);
      copy.set(out.subarray(0, at)); for (let index = 0; index < length; index++) copy[at + index] = random() < 0.5 ? below(256) : out[below(n)] ?? 0;
      copy.set(out.subarray(at), at + length); out = copy;
    } else if (kind < 0.9) {
      const length = Math.min(1 + below(random() < 0.2 ? 2000 : 80), n - at - 1);
      if (length <= 0 || n - length < 300) continue;
      const copy = new Uint8Array(n - length); copy.set(out.subarray(0, at)); copy.set(out.subarray(at + length), at); out = copy;
    } else {
      const source = below(n - 300), target = below(n - 300);
      out = Uint8Array.from(out).copyWithin(target, source, source + 64 + below(200));
    }
  }
  return out;
}

test('chains of edited checkpoints encode exactly as the full encoder', () => {
  let checks = 0;
  for (let chain = 0; chain < 60; chain++) {
    let bytes = world(2000 + below(random() < 0.3 ? 120_000 : 20_000));
    let memo: PhysicsReferenceMemo = encodePhysicsReferencesMemo(bytes).memo;
    expect(memo.encoded).toEqual(encodePhysicsReferences(bytes));
    for (let edit = 0; edit < 5; edit++) {
      bytes = step(bytes);
      if (bytes.length < 300) break;
      const next = encodePhysicsReferencesMemo(bytes, memo);
      expect(next.encoded, `chain ${chain}, edit ${edit}`).toEqual(encodePhysicsReferences(bytes));
      memo = next.memo; checks++;
    }
  }
  expect(checks).toBeGreaterThan(250);
}, 60_000);

test('an unchanged checkpoint returns the same references, and a tiny one takes the full encoder', () => {
  const bytes = world(50_000), first = encodePhysicsReferencesMemo(bytes);
  expect(encodePhysicsReferencesMemo(Uint8Array.from(bytes), first.memo).encoded).toEqual(first.encoded);
  const tiny = world(100);
  expect(encodePhysicsReferencesMemo(tiny, first.memo).encoded).toEqual(encodePhysicsReferences(tiny));
});

test('writing to a returned encoding cannot change a later one (J206 review)', () => {
  const bytes = world(40_000), first = encodePhysicsReferencesMemo(bytes);
  first.encoded[0] = (first.encoded[0] ?? 0) ^ 255;
  expect(encodePhysicsReferencesMemo(Uint8Array.from(bytes), first.memo).encoded).toEqual(encodePhysicsReferences(bytes));
});

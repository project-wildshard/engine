// oxlint-disable-next-line import/no-nodejs-modules -- Exact predecessor encoder byte pins in the Node test host.
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { Rng } from '../core/rng';
import { MAX_REFERENCE_BYTES, encodePhysicsReferences, decodePhysicsReferences, validatePhysicsReferences } from './snapshotPhysics';

test('minimum-match qualification reconstructs every byte across offsets, tails and native-sized repeated blocks', () => {
  const block = Uint8Array.from({ length: 8191 }, (_, i) => (Math.imul(i, 73) ^ (i >>> 3)) & 255);
  for (const offset of [0, 1, 15]) for (const length of [1, 15, 63, 64, 65, 129, 65537, 2_097_169]) {
    const backing = new Uint8Array(length + offset + 7).fill(173), raw = backing.subarray(offset, offset + length);
    for (let i = 0; i < length; i++) raw[i] = block[(i + offset) % block.length] ?? 0;
    for (let i = 4093; i < length; i += 32771) raw[i] = (raw[i] ?? 0) ^ 37;
    const before = backing.slice(), packed = encodePhysicsReferences(raw);
    expect(packed.length).toBeLessThanOrEqual(MAX_REFERENCE_BYTES);
    validatePhysicsReferences(packed, length);
    const decoded = decodePhysicsReferences(packed, length);
    expect(decoded.length).toBe(length);
    expect(decoded.every((value, i) => value === raw[i])).toBe(true);
    expect(backing.every((value, i) => value === before[i])).toBe(true);
    expect(decoded.buffer).not.toBe(raw.buffer);
  }
});

test('minimum-match qualification preserves the original encoded bytes', () => {
  const rng = new Rng(731), basis = Uint8Array.from({ length: 8191 }, () => rng.int(0, 255));
  const mixed = new Uint8Array(basis.length + 17); mixed.set(basis.subarray(9)); mixed.fill(31, basis.length - 9);
  const block = Uint8Array.from({ length: 8191 }, (_, i) => (Math.imul(i, 73) ^ (i >>> 3)) & 255);
  const geometry = Uint8Array.from({ length: 65537 }, (_, i) => block[(i + 1) % block.length] ?? 0);
  for (let i = 4093; i < geometry.length; i += 32771) geometry[i] = (geometry[i] ?? 0) ^ 37;
  // Captured from 2416816408, before sparse indexing or minimum-match qualification.
  const cases = [
    { raw: basis, basis: undefined, length: 8194, hash: 'b2e9dded6288578e9f097c83fb769261526a2680fa2c92d9df34352980f60bc9' },
    { raw: mixed, basis, length: 48, hash: '76a13a26ab860d04b07d100b3ae2404a02fadc5adcc3b4c4bac0083af965aa23' },
    { raw: geometry, basis: undefined, length: 2307, hash: '14301dff7a4f9ffd7643d3981005e41781acd2c5cfa28b641122bbe159f85788' },
    { raw: new Uint8Array(4096), basis: undefined, length: 13, hash: 'ae8141b89ed5a62d4efe9177024cabab3ddb743865de25e0cef6c4c3251130db' },
  ];
  for (const row of cases) {
    const encoded = encodePhysicsReferences(row.raw, row.basis);
    expect(encoded.length).toBe(row.length);
    expect(createHash('sha256').update(encoded).digest('hex')).toBe(row.hash);
  }
});

test('basis copies and incompressible literal tails keep complete original bytes', () => {
  const rng = new Rng(731), basis = Uint8Array.from({ length: 8191 }, () => rng.int(0, 255));
  for (const supplied of [undefined, basis]) {
    const raw = new Uint8Array(basis.length + 17); raw.set(basis.subarray(9), 0); raw.fill(31, basis.length - 9);
    const packed = encodePhysicsReferences(raw, supplied);
    validatePhysicsReferences(packed, raw.length, supplied?.length);
    expect(decodePhysicsReferences(packed, raw.length, supplied)).toEqual(raw);
  }
});

test.each([1, 64])('previous literal/copy tokens retain overlapping distance %i', distance => {
  const encoded = Uint8Array.from([0, 63, 0, ...Array.from({ length: 64 }, (_, i) => i), 1, distance, 0, 0, 0, 64, 0, 0, 0]);
  const expected = Uint8Array.from({ length: 128 }, (_, i) => i < 64 ? i : distance === 1 ? 63 : i - 64);
  validatePhysicsReferences(encoded, 128);
  expect(decodePhysicsReferences(encoded, 128)).toEqual(expected);
});

test('previous external references and malformed bounds retain their defining behavior', () => {
  const basis = Uint8Array.from({ length: 256 }, (_, i) => i), encoded = Uint8Array.from([2, 7, 0, 0, 0, 128, 0, 0, 0]);
  expect(decodePhysicsReferences(encoded, 128, basis)).toEqual(basis.subarray(7, 135));
  expect(() => decodePhysicsReferences(encoded, 128)).toThrow('basis reference');
  expect(() => decodePhysicsReferences(encoded, 128, new Uint8Array(64))).toThrow('basis reference');
  expect(() => decodePhysicsReferences(Uint8Array.of(1, 0, 0, 0, 0, 64, 0, 0, 0), 64)).toThrow('reference');
  expect(() => decodePhysicsReferences(Uint8Array.of(0, 63, 0, 1), 64)).toThrow('literal length');
  expect(() => encodePhysicsReferences(new Uint8Array())).toThrow('byte bounds');
  expect(() => encodePhysicsReferences(Uint8Array.of(1), new Uint8Array())).toThrow('basis exceeds');
});


test('dense sliding hash windows keep original collision order, unaligned views and 64-byte tails', () => {
  // Scan every byte without the assertion framework enumerating millions of numeric keys.
  const block = Uint8Array.from({ length: 257 }, (_, i) => (Math.imul(i, 73) ^ (i >>> 3)) & 255), digest = createHash('sha256');
  for (const offset of [0, 1, 2, 3, 15]) for (const tail of [0, 63, 64, 65]) for (const basis of [undefined, block]) {
    const backing = new Uint8Array(offset + 131072 + tail + 3).fill(189), raw = backing.subarray(offset, offset + 131072 + tail);
    for (let i = 0; i < raw.length; i++) raw[i] = block[i % block.length] ?? 0;
    for (let i = raw.length - tail; i < raw.length; i++) raw[i] = (Math.imul(i, 31) + tail) & 255;
    const before = backing.slice(), encoded = encodePhysicsReferences(raw, basis);
    digest.update(String(encoded.length)).update(':').update(encoded);
    const decoded = decodePhysicsReferences(encoded, raw.length, basis);
    expect(decoded.length).toBe(raw.length);
    expect(decoded.every((value, i) => value === raw[i])).toBe(true);
    expect(decoded.buffer).not.toBe(raw.buffer);
    expect(backing.every((value, i) => value === before[i])).toBe(true);
  }
  // Forty complete encoded outputs captured from 98035eec39 before this cut.
  expect(digest.digest('hex')).toBe('d1bfd6f13193a7dd5ef207ee1aac72246d32869b997fcbbe020168957d8801b5');
});

test('native-sized terminal references retain their original framing and every decoded byte', () => {
  const raw = new Uint8Array(8 * 1024 * 1024), encoded = encodePhysicsReferences(raw);
  // Captured from the predecessor before skipping its unused terminal indexing.
  expect(encoded.length).toBe(13);
  expect(createHash('sha256').update(encoded).digest('hex')).toBe('aa709aedb8546e944ce683a55eb4f3cbcd2bb7f77d9780b84b925f555748786b');
  const decoded = decodePhysicsReferences(encoded, raw.length);
  expect(decoded.length).toBe(raw.length);
  expect(decoded.some(value => value !== 0)).toBe(false);
  expect(decoded.buffer).not.toBe(raw.buffer);
});

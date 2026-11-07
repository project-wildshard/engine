// oxlint-disable-next-line import/no-nodejs-modules -- Independent canonical base64 oracle, never the production decoder.
import { Buffer } from 'node:buffer';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare exhaustive decoder outcomes without framework overhead per vector.
import assert from 'node:assert/strict';
import { expect, test } from 'vitest';
import { unpackSnapshotBase64 } from '../src/shared/engine/sim/snapshotBase64';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function outcome(read: () => Uint8Array): Uint8Array | string {
  try { return read(); } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return error.message;
  }
}
function reference(data: string): Uint8Array {
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(data)) throw new RangeError('Invalid snapshot base64');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64') !== data) throw new RangeError('Noncanonical snapshot base64');
  return Uint8Array.from(bytes);
}
function compare(data: string): void {
  assert.deepEqual(outcome(() => unpackSnapshotBase64(data)), outcome(() => reference(data)), JSON.stringify(data));
}

test('all byte tails retain exact bytes and refuse every noncanonical padding-bit combination', () => {
  compare('');
  for (let a = 0; a < 256; a++) {
    const single = Buffer.from([a]).toString('base64'), first = single[0], second = single[1];
    if (first === undefined || second === undefined) throw new Error('Missing encoded byte');
    for (let bits = 0; bits < 16; bits++) compare(`${first}${alphabet[(alphabet.indexOf(second) & 48) | bits]}==`);
    for (let b = 0; b < 256; b++) {
      const pair = Buffer.from([a, b]).toString('base64'), third = pair[2];
      if (third === undefined) throw new Error('Missing encoded pair');
      for (let bits = 0; bits < 4; bits++) compare(`${pair.slice(0, 2)}${alphabet[(alphabet.indexOf(third) & 60) | bits]}=`);
    }
  }
});

test('malformed lengths, padding placement, characters and mixed errors retain refusal priority', () => {
  for (const encoded of ['AAAA', 'AA==', 'AAA=', 'AB==', 'AAB=', '====', 'A===', 'AA=A', 'A=AA', 'AAA\n', 'AA==\n', 'AA==AAAA', 'AAAA====']) {
    compare(encoded);
    for (let at = 0; at <= encoded.length; at++) for (let code = 0; code < 256; code++) {
      compare(encoded.slice(0, at) + String.fromCodePoint(code) + encoded.slice(at + 1));
    }
  }
  for (const character of ['\u0100', '\uD800', '\uFFFF', '\u2028', '\u2029']) {
    for (let at = 0; at < 4; at++) compare('AAAA'.slice(0, at) + character + 'AAAA'.slice(at + 1));
  }
});

test('large offset views decode into independent owned bytes without changing the source', () => {
  const source = Uint8Array.from({ length: 1_000_031 }, (_, i) => (Math.imul(i, 73) ^ (i >>> 3)) & 255);
  for (const length of [1, 2, 3, 4, 8191, source.length - 7]) {
    const view = source.subarray(7, 7 + length), before = view.slice(), encoded = Buffer.from(view).toString('base64');
    const a = unpackSnapshotBase64(encoded), b = unpackSnapshotBase64(encoded);
    assert.deepEqual(a, before); a.fill(0); assert.deepEqual(b, before); assert.deepEqual(view, before);
    expect(a.buffer).not.toBe(b.buffer); expect(a.buffer).not.toBe(source.buffer);
  }
});

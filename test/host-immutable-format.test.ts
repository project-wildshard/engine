// SHARD-COMPAT SI1: engine's host/immutable and host/shardfile field parser are the format's own, so engine, the sdk and
// the API name immutable bytes and admit a field with one implementation.
import { expect, test } from 'vitest';
import { encodeCanonicalJson as formatEncode, hashImmutableBytes as formatHash } from '@wildshard/format/immutable';
import { parseShardfileField as formatParseField } from '@wildshard/format/shardSchema';
import { encodeCanonicalJson, hashImmutableBytes } from '../src/shared/host/immutable';
import { parseShardfileField } from '../src/shared/host/shardfile';

test('host/immutable encodes and hashes as the format does', () => {
  const value = { b: [3, { z: 1, a: 'é' }], a: null, 'B': true };
  expect(encodeCanonicalJson(value)).toBe(formatEncode(value));
  expect(encodeCanonicalJson(value)).toBe('{"B":true,"a":null,"b":[3,{"a":"é","z":1}]}\n');
  const bytes = new TextEncoder().encode(encodeCanonicalJson(value));
  expect(hashImmutableBytes(bytes)).toBe(formatHash(bytes));
});

test('host/shardfile admits a field as the format does, and refuses as it does', () => {
  expect(parseShardfileField('ui', [])).toEqual(formatParseField('ui', []));
  expect(() => parseShardfileField('ui', 'nope')).toThrow();
  expect(() => formatParseField('ui', 'nope')).toThrow();
});

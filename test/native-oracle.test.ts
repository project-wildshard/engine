import { expect, test } from 'vitest';
import { encodeCanonicalJson, hashImmutableBytes } from '../src/shared/host/immutable';
import { fencedNativeOracle } from './fixtures/native-oracle';
import { nineNativeOracle, NINE_NATIVE_ORACLE } from './fixtures/nine-native-oracle';
import { nineNativeOracleInputs } from './fixtures/nine-native-oracle-inputs';
import { nalatiNativeBoot } from './fixtures/nalati-native-boot';

test('the fenced typed Nine oracle retains the complete former shipping wire', async () => {
  const wire = new TextEncoder().encode(JSON.stringify(await nineNativeOracle()));
  expect(wire.byteLength).toBe(731);
  expect(hashImmutableBytes(wire)).toBe('0316e2deaa4976a3a3b232f6aeb0bccac20bef74559f3af4e42411e6cca8a117');
});

test('a divergent cached parent cannot supply native policy facts', async () => {
  await expect(fencedNativeOracle(NINE_NATIVE_ORACLE, () => {
    const rows = nineNativeOracleInputs(); rows.constants.jianPolicy.eye += 1; return rows;
  })).rejects.toThrow('differs from its fenced source constructor');
});

test('the fenced typed Nalati oracle retains every former boot byte', async () => {
  const rows = await nalatiNativeBoot(), ordered = `${JSON.stringify(rows)}\n`;
  expect(ordered).toBe(encodeCanonicalJson(rows));
  const wire = new TextEncoder().encode(ordered);
  expect(wire.byteLength).toBe(109461);
  expect(hashImmutableBytes(wire)).toBe('73495b73fb1f983c9508ede352b75bd9782f41445a70408171336194a66f4c72');
});

test('the fenced typed Nalati oracle retains every former assembly byte', async () => {
  const { nalatiNativeAssembly } = await import('./fixtures/nalati-native-assembly');
  const rows = await nalatiNativeAssembly(), ordered = `${JSON.stringify(rows)}\n`;
  expect(ordered).toBe(encodeCanonicalJson(rows));
  const wire = new TextEncoder().encode(ordered);
  // The three lairs' first-kill skins are all this oracle has gained: every former byte holds around them.
  const skins = /"drop":\{"skin":(?:null|"[^"]*")\},/gu;
  expect(ordered.match(skins)).toEqual(['"drop":{"skin":"irbis-sabre"},', '"drop":{"skin":null},', '"drop":{"skin":"sky-wolf-bow"},']);
  const former = new TextEncoder().encode(ordered.replaceAll(skins, ''));
  expect(wire.byteLength).toBe(32432);
  expect(former.byteLength).toBe(32350);
  expect(hashImmutableBytes(former)).toBe('fc2060b6659b3f8163a1ad393168264e8e3c4e172398bd4b6dcefcac724f2047');
});

test('the fenced typed Nine oracle retains every former constants byte', async () => {
  const { nineNativeConstants } = await import('./fixtures/nine-native-constants');
  const wire = new TextEncoder().encode(JSON.stringify(await nineNativeConstants(), (_key, entry: unknown) =>
    typeof entry === 'number' && Object.is(entry, -0) ? '-0' : entry));
  expect(wire.byteLength).toBe(99568);
  expect(hashImmutableBytes(wire)).toBe('ec24af0a2d6507add4a5fca4a8a8714044333a6d11fe7f7484d559603a41dc05');
});

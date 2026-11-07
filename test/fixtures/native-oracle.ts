import { encodeCanonicalJson } from '../../src/shared/host/immutable';
import type { NativeProgramSpec } from './native-program';
import { nativeProgramFixture } from './native-program';

/** Match a canonical JSON reader's original object iteration order while
 * retaining the complete typed value. Array order and numbers stay intact. */
export function canonicalNativeOracleInput<T>(input: T): T {
  const value = structuredClone(input);
  const order = (row: unknown): void => {
    if (Array.isArray(row)) { for (const child of row) order(child); return; }
    if (row === null || typeof row !== 'object') return;
    for (const [key, child] of Object.entries(row).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      Reflect.deleteProperty(row, key);
      Object.defineProperty(row, key, { value: child, writable: true, configurable: true, enumerable: true });
      order(child);
    }
  };
  order(value); return value;
}

/** Keep typed oracle facts only when a fresh source-fenced child reconstructs
 * their complete canonical wire. No parsed JSON is cast into the parent type.
 * The spec must name the raw constructor and all defining input roots. */
export function nativeOracleProgramSpec(spec: NativeProgramSpec): NativeProgramSpec {
  return {...spec, inputs: [...spec.inputs, 'test/fixtures/native-oracle.ts', 'test/fixtures/native-program.ts']};
}

export async function fencedNativeOracle<T>(spec: Parameters<typeof nativeProgramFixture>[0], make: () => T | Promise<T>): Promise<T> {
  const [text, value] = await Promise.all([
    nativeProgramFixture(nativeOracleProgramSpec(spec)),
    Promise.resolve().then(make),
  ]);
  const child: unknown = JSON.parse(text);
  if (encodeCanonicalJson(value) !== encodeCanonicalJson(child))
    throw new Error(`Native oracle ${spec.id} differs from its fenced source constructor`);
  return value;
}

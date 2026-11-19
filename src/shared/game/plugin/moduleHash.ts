import { sha256 as digest } from '@wildshard/engine/core/sha256';

export function sha256(bytes: Uint8Array): string { return digest(bytes); }

/** One loaned byte source's verified hash: the array, its buffer, offset and length when it was hashed. */
interface LoanedHash { readonly buffer: ArrayBufferLike; readonly offset: number; readonly length: number; readonly hash: string }
const loaned = new WeakMap<Uint8Array, LoanedHash>();
/**
 * SHA-256 of a module's LOANED bytes (a product reader's immutable asset array, lent read-only), memoised on that byte
 * source's identity: the same array object over the same buffer, offset and length. The build-time integrity check still
 * runs once per distinct byte source; a copy, a decoded inline module or a re-pointed view hashes again. T10: a Nalati
 * drive hashed the same loaned return modules again in each admission path (~36 ms a hash on the Simulator, three times).
 */
export function loanedSha256(bytes: Uint8Array): string {
  const known = loaned.get(bytes);
  if (known !== undefined && known.buffer === bytes.buffer && known.offset === bytes.byteOffset && known.length === bytes.byteLength) return known.hash;
  const hash = sha256(bytes);
  loaned.set(bytes, { buffer: bytes.buffer, offset: bytes.byteOffset, length: bytes.byteLength, hash });
  return hash;
}

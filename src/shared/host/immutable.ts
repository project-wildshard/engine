// SHARD-COMPAT SI1: the stable JSON encoding and the SHA-256 that names immutable wire bytes are the format's
// (`@wildshard/format/immutable`, shard-format 9e0033b); engine keeps this import path for its callers.
import { encodeCanonicalJson as encode, hashImmutableBytes as hash } from '@wildshard/format/immutable';

/** Stable JSON encoding shared by author tools without importing the project compiler. */
export function encodeCanonicalJson(value: unknown): string { return encode(value); }
/** SHA-256 of exact wire bytes, independent of installation path or build time. */
export function hashImmutableBytes(bytes: Uint8Array): string { return hash(bytes); }

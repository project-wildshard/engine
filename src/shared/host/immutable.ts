// oxlint-disable-next-line import/no-nodejs-modules -- Author tools hash exact immutable wire bytes.
import { createHash } from 'node:crypto';

/** Stable JSON encoding shared by author tools without importing the project compiler. */
export function encodeCanonicalJson(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (typeof input === 'object' && input !== null) return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, val]) => [key, canonical(val)]));
    return input;
  };
  return `${JSON.stringify(canonical(value))}\n`;
}
/** SHA-256 of exact wire bytes, independent of installation path or build time. */
export function hashImmutableBytes(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

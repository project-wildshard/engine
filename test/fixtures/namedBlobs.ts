import { sha256 } from '../../src/shared/game/plugin/moduleHash';

/** Name the test's immutable inputs at the real product-file boundary. */
export function fixtureBlob(name: string, format: string, bytes: Uint8Array, metadata: Readonly<Record<string, unknown>> = {}) {
  return { name, format, bytes, metadata };
}
export function fixtureNamedBlobs(rows: readonly ReturnType<typeof fixtureBlob>[]) {
  return {
    files: rows.map(row => ({ name: row.name, hash: sha256(row.bytes), ...row.metadata })),
    assets: new Map(rows.map(row => [sha256(row.bytes), row.bytes])),
  };
}

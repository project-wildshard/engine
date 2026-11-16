import { sha256 } from '../../src/shared/game/plugin/moduleHash';

/** Name the test's immutable inputs at the real product-file boundary. */
export function fixtureBlob(name: string, format: string, bytes: Uint8Array, metadata: Readonly<Record<string, unknown>> = {}) {
  return { name, format, bytes, metadata };
}
export function fixtureNamedBlobs(rows: readonly ReturnType<typeof fixtureBlob>[]) {
  const names = new Set<string>(), assets = new Map<string, Uint8Array>();
  const files = rows.map(row => {
    const hash = sha256(row.bytes);
    if (names.has(row.name) || assets.has(hash)) throw new Error('Duplicate blob name or content reference');
    names.add(row.name); assets.set(hash, row.bytes);
    return { name: row.name, hash, ...row.metadata };
  });
  files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return { files, assets: new Map([...assets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) };
}

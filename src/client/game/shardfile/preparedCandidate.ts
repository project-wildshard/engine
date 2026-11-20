/**
 * ONE-FORMAT OF23a: `wildshard prepare` (and `wildshard dev`) serve their shard inline as `ws-shardfile` and at
 * `/shardfiles/<slug>/`, where a release serves it. When this build's verdict table pins that product (an engine-pinned
 * shard such as Pine Hollow), the candidate's new index read as a stale client: the page reloaded, then failed at
 * admission.modules (StaleClientError), so no pinned shard could prepare a new revision. A page that owns its inline
 * shard takes the candidate's rows out of the table before any descriptor is read: the candidate is then admitted by its
 * own index, as an unlisted product is (folder.ts `checkBuiltIndex`, `readFolderDescriptor`).
 */

/** Remove the inline candidate's verdict rows; returns how many left. Only DEVSERVER and preparation-only pages call it. */
export function releaseInlineCandidate(inline: string | null | undefined, table: unknown = Reflect.get(globalThis, '__WS_SHARDFILE_VERDICTS__')): number {
  if (typeof inline !== 'string' || !Array.isArray(table)) return 0;
  let parsed: unknown;
  try { parsed = JSON.parse(inline); } catch { return 0; }
  const identity: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'identity') : undefined;
  const slug: unknown = typeof identity === 'object' && identity !== null ? Reflect.get(identity, 'slug') : undefined;
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/u.test(slug)) return 0;
  const root = `/shardfiles/${slug}/`, rows: unknown[] = table;
  let removed = 0;
  for (let at = rows.length - 1; at >= 0; at--) {
    const row = rows[at];
    const path: unknown = typeof row === 'object' && row !== null ? Reflect.get(row, 'path') : undefined;
    if (typeof path === 'string' && path.startsWith(root)) { rows.splice(at, 1); removed++; }
  }
  return removed;
}

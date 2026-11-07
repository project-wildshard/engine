import { controlFileHashes } from '@wildshard/format/admissionControl';
import type { Shardfile } from '@wildshard/format/shardSchema';

/** I2: only an exact first-party validation receipt may use this transport subset. Keep the full declaration;
 * tile scopes verify their own later reads. Global/critical and manifest-construction bytes stay ready. */
export function controlFiles(source: Shardfile, selected: readonly Shardfile['files'][number][]): Shardfile['files'] {
  const needed = controlFileHashes(source);
  return selected.filter(file => needed.has(file.hash));
}

/** Remaining immutable transport warms nearest tiles first, dependencies with their first tile; nontile bytes last.
 * This order never changes the renderer's own required-tile priority or content declarations. */
export function deferredFiles(source: Shardfile, selected: readonly Shardfile['files'][number][], initial: ReadonlySet<string>): Shardfile['files'] {
  const files = new Map(source.files.map(file => [file.hash, file])), priority = new Map<string, number>();
  const roots = [...source.tiles.map(tile => ({ refs: tile.files, x: (tile.bounds.min[0] + tile.bounds.max[0]) / 2, z: (tile.bounds.min[2] + tile.bounds.max[2]) / 2 })),
    ...(source.late ?? []).filter(row => row.at !== undefined).map(row => ({ refs: [row.hash], x: row.at?.[0] ?? source.spawn.x, z: row.at?.[1] ?? source.spawn.z }))];
  for (const root of roots) {
    const distance = Math.hypot(root.x - source.spawn.x, root.z - source.spawn.z);
    const pending = [...root.refs], seen = new Set<string>();
    while (pending.length > 0) {
      const hash = pending.pop(); if (hash === undefined || seen.has(hash)) continue;
      seen.add(hash); priority.set(hash, Math.min(priority.get(hash) ?? Infinity, distance));
      pending.push(...files.get(hash)?.dependencies ?? []);
    }
  }
  return selected.filter(file => !initial.has(file.hash)).sort((a, b) => {
    const left = priority.get(a.hash), right = priority.get(b.hash);
    return left === right ? 0 : left === undefined ? 1 : right === undefined ? -1 : left - right;
  });
}

/** Declared after-control library closure for native/lazy products; actual readers can still request it earlier. */
export function lateFiles(source: Shardfile, selected: readonly Shardfile['files'][number][]): Shardfile['files'] {
  const files = new Map(source.files.map(file => [file.hash, file])), wanted = new Set<string>(), pending = (source.late ?? []).map(row => row.hash);
  while (pending.length > 0) {
    const hash = pending.pop(); if (hash === undefined || wanted.has(hash)) continue;
    wanted.add(hash); pending.push(...files.get(hash)?.dependencies ?? []);
  }
  const initial = new Set(controlFiles(source, selected).map(file => file.hash));
  return deferredFiles(source, selected.filter(file => wanted.has(file.hash)), initial);
}

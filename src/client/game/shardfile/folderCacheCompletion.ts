import type { Scope } from '@wildshard/engine/app/scope';
import { saves } from '@wildshard/engine/saves/runtime';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { CachedFolder, FolderOptions } from './folder';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';

/** Construct outside admission's decoding context: late warming must not retain its temporary transport/result maps.
 * A partial online admission never publishes a fully visited offline index until every selected byte is verified. */
export function folderCacheCompletion(source: Shardfile, options: FolderOptions, selected: readonly Shardfile['files'][number][],
  remaining: readonly Shardfile['files'][number][], publication: CachedFolder): ((scope: Scope) => Promise<void>) | undefined {
  const cache = options.cache, descriptor = outputDescriptor(source);
  if (cache === undefined || options.offline || descriptor === undefined || remaining.length === 0) return undefined;
  let completion: Promise<void> | undefined;
  return async scope => {
    if (completion !== undefined) return completion;
    const work = async (): Promise<void> => {
      const alive = (): void => { if (scope.disposed || scope.disposing) throw new DOMException('Offline warming owner retired', 'AbortError'); };
      alive();
      const { ClientAssets } = await import('./clientAssets');
      const lower = { ...options, fetch: options.backgroundFetch ?? options.fetch };
      // A foreground worker transport must not turn this low-priority queue
      // into competing foreground fetches. Verified cache hits still apply.
      delete lower.verifiedResponse; delete lower.transport; delete lower.fetchRange;
      const reader = new ClientAssets(source, new Map(), lower), base = new URL('.', options.base).href;
      const present = async (hash: string, size: number): Promise<boolean> => {
        if (cache.verifiedPresent !== undefined) return cache.verifiedPresent(hash, size);
        const bytes = await cache.asset(base, hash);
        return bytes !== null && bytes.length === size && await options.hash(bytes) === hash;
      };
      const sections = [...descriptor.index.sections, ...descriptor.index.schemas];
      const release = cache.pin?.([...selected.map(file => file.hash), ...source.requires.commons, ...sections.map(section => section.hash)]);
      try {
        for (const file of remaining) {
          alive(); if (await present(file.hash, file.compressed)) continue;
          const bytes = await reader.read(file.hash); alive();
          if (!await present(file.hash, file.compressed)) {
            const stored = cache.putAssetBackground === undefined ? await cache.putAsset(base, file.hash, bytes)
              : await cache.putAssetBackground(base, file.hash, bytes);
            if (stored === false || !await present(file.hash, file.compressed)) return;
          }
        }
        if (descriptor.cacheStored !== undefined && !await descriptor.cacheStored) return;
        for (const file of [...selected.map(row => ({ hash: row.hash, bytes: row.compressed })),
          ...source.requires.commons.map(hash => ({ hash, bytes: source.requires.commonsWire[hash] ?? 0 })), ...sections]) {
          alive(); if (!await present(file.hash, file.bytes)) return;
        }
        alive(); await cache.putFolder(base, publication); void saves.persist();
      } finally { release?.(); }
    };
    const pending = work(); completion = pending;
    try { await pending; } finally { if (completion === pending) completion = undefined; }
  };
}

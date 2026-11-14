import type { SceneBakeSource } from './sceneSources';
import type { BakedByteResource } from './bakedKinds';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';

/** Resolve admitted bake names for the existing URL-only mesh and deflate
 * readers. Public URLs and the original source descriptor keep their identity. */
export function sceneBakeFiles(source: SceneBakeSource, product: Pick<ShardFolder, 'hasFile' | 'url'>): SceneBakeSource {
  let urls: Record<string, string> | undefined;
  for (const [piece, file] of Object.entries(source.urls)) {
    if (!product.hasFile(file)) continue;
    urls ??= { ...source.urls };
    urls[piece] = product.url(file);
  }
  let resources: BakedByteResource[] | undefined;
  for (const [index, row] of source.resources?.entries() ?? []) {
    if (!product.hasFile(row.url)) continue;
    resources ??= [...source.resources ?? []];
    resources[index] = { ...row, url: product.url(row.url) };
  }
  return urls === undefined && resources === undefined ? source : { ...source,
    ...(urls === undefined ? {} : { urls }), ...(resources === undefined ? {} : { resources }) };
}

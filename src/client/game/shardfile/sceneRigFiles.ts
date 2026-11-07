import type { ModelLibraryRows } from '../plugin/geometry';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';

/** Resolve existing product-owned names for mesh, rig and geometry-pool loaders.
 * Ordinary public URLs and the original descriptor remain untouched. */
export function sceneRigFiles(rows: ModelLibraryRows<string, string>, product: Pick<ShardProduct, 'hasFile' | 'url'>): ModelLibraryRows<string, string> {
  let meshes: Record<string, string> | undefined;
  for (const [name, source] of Object.entries(rows.meshUrls)) {
    if (!product.hasFile(source)) continue;
    meshes ??= { ...rows.meshUrls };
    meshes[name] = product.url(source);
  }
  const rigs = rows.rigs;
  let urls: Record<string, string> | undefined;
  if (rigs !== undefined) for (const [creature, source] of Object.entries(rigs.bodies.urls)) {
    if (!product.hasFile(source)) continue;
    urls ??= { ...rigs.bodies.urls };
    urls[creature] = product.url(source);
  }
  let pools: NonNullable<ModelLibraryRows<string, string>['geometryPools']>[number][] | undefined;
  for (const [index, pool] of rows.geometryPools?.entries() ?? []) {
    if (!product.hasFile(pool.url)) continue;
    pools ??= [...rows.geometryPools ?? []];
    pools[index] = { ...pool, url: product.url(pool.url) };
  }
  return meshes === undefined && urls === undefined && pools === undefined ? rows : { ...rows,
    ...(meshes === undefined ? {} : { meshUrls: meshes }),
    ...(urls === undefined || rigs === undefined ? {} : { rigs: { ...rigs, bodies: { ...rigs.bodies, urls } } }),
    ...(pools === undefined ? {} : { geometryPools: pools }) };
}

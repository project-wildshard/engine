import { manifestFolders, shardProducts } from './shard-outputs.mjs';

/** Every shipped discovery, including multi-output folders, plus the grid.
 * @param {string} root
 * @returns {string[]}
 */
export function frameFloorShards(root) {
  return [...shardProducts(root, manifestFolders(root))
    .map(row => row.slug), 'grid'];
}

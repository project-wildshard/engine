// Operational readers. In singleplayer this imports the manifest registry; engine has none (J88), so a shard is what its
// pinned product's discovery document says it is. `scripts/pins.ts install` is what fills `out/`.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shardFolders } from './shard-folders.mjs';

/** Every installed product's discovery row, in title order.
 * @param {string} [root]
 * @returns {Promise<{ slug: string, name: string, status: string, order?: number }[]>} */
export function readShards(root = resolve(import.meta.dirname, '..')) {
  const rows = shardFolders(root).flatMap((folder) => {
    const file = resolve(root, 'out', folder, 'mounts/shardfiles', folder, 'discovery.json');
    return existsSync(file) ? [JSON.parse(readFileSync(file, 'utf8')).data] : [];
  });
  return Promise.resolve(rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
}

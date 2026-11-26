// Engine has no shard source (J88): a shard here is a pinned product under `out/`, so this replaces `gen-shards.mjs`'s
// list of the same name for the harness tools that only need to know which shards exist.
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Each installed product's folder, sorted: `scripts/pins.mjs install` is what fills `out/`.
 * @param {string} root @returns {string[]} */
export function shardFolders(root) {
  const products = resolve(root, 'out');
  if (!existsSync(products)) return [];
  return readdirSync(products, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && existsSync(resolve(products, entry.name, 'shard.json')))
    .map((entry) => entry.name).sort();
}

// J122: a layer's package.json `exports`, not its folders, says where a module lives: `@wildshard/engine/physics/query`
// keeps its name when src/engine sorts into client/, shared/, server/ and cook/. Tools resolve specifiers here, and
// ratchets that span the move compare rows here, so neither reads a sorted file as new or gone.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const manifests = new Map();

/** The repo file `@wildshard/<layer>[/<sub>]` exports, or null when the layer does not export it.
 * @param {string} layer @param {string | undefined} sub @param {string} [root] @returns {string | null} */
export function exportedPath(layer, sub, root = REPO) {
  const file = resolve(root, 'package.json');
  const prefix = { engine: '', game: 'game/', sdk: 'host/' }[layer];
  if (prefix === undefined) return null;
  if (!manifests.has(file)) manifests.set(file, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).exports ?? {} : {});
  const target = manifests.get(file)[sub === undefined ? '.' : `./${prefix}${sub}`];
  return typeof target === 'string' && target.startsWith('./') ? target.slice(2) : null;
}

/** A layer path without its side folder: the identity of a file across a sort or a retag.
 * @param {string} path @returns {string} */
export const unsortedPath = path => path.replace(/^src\/(?:client|cook|server|shared)\/(engine|game)\//u, 'src/$1/').replace(/^src\/sharddev\//u, 'src/sdk/');

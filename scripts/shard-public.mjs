// S2: a gathered shard keeps its published files in its own folder. The site still serves them from public/ at
// the same URLs with the same bytes: `pnpm gen` rewrites these gitignored aliases first, before anything walks public/.
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The shards gathered so far. Open Plots follows; its products share one source folder. */
export const GATHERED_SHARDS = Object.freeze(['_template', 'blender-template', 'ink-cel-valley', 'pastel-plain', 'sunscar-dunes', 'far-reach', 'driftwood-isle', 'nalati-grasslands', 'pine-hollow', 'nine-dragon-stack']);

/** Shards whose public/assets/<slug> tree is gathered too: src/shards/<slug>/assets/public/ holds it, gen writes the aliases.
 * URLs, map inputs and every reader keep the public path, so the move renames nothing they name. To add a shard:
 *  1. Check no live tool writes under public/assets/<slug>. A write lands on a gitignored alias and the next gen overwrites
 *     it, so point the tool at assets/public first. targets.json outputs count: check-model-sources needs them on disk.
 *  2. Move every tracked file there, add the slug here and `/public/assets/<slug>/` to .gitignore, one shard per commit.
 *  3. Prove it from an archive with no aliases: gen, every product by SHA-256 against the parent, and the full
 *     check-closed-components with docs and art present. Scripts and tests read the alias, so their paths don't change.
 * gen only copies: a file deleted here leaves its alias until the folder is cleared. */
export const PUBLIC_TREES = Object.freeze(['sunscar-dunes', 'driftwood-isle']);

/** Where the entry crawl's record lives for a shard: its own folder once gathered, else its public folder.
 * @param {string} root @param {string} slug */
export const entryReadsFile = (root, slug) => GATHERED_SHARDS.includes(slug)
  ? resolve(root, 'src/shards', slug, 'look/entry-reads.json')
  : resolve(root, 'public/assets', slug, 'entry-reads.json');

/** Copy every gathered shard's published files to their public aliases. @param {string} root */
export function publishShardFiles(root) {
  for (const slug of GATHERED_SHARDS) {
    const alias = resolve(root, 'public/assets', slug, 'entry-reads.json');
    mkdirSync(dirname(alias), { recursive: true });
    if (existsSync(entryReadsFile(root, slug))) copyFileSync(entryReadsFile(root, slug), alias);
  }
  for (const slug of PUBLIC_TREES) {
    const tree = resolve(root, 'src/shards', slug, 'assets/public');
    if (existsSync(tree)) cpSync(tree, resolve(root, 'public/assets', slug), { recursive: true, force: true });
  }
}

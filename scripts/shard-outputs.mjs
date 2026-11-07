// SF88g (G538/G539): one source folder may emit several shardfile products. `src/shards/<folder>/outputs.json` lists them:
// `{ "outputs": [{ "slug": "<product slug>", "manifest": { …overrides of the folder's manifest.json }, …the shard's own
// fields }] }`. Without the file a folder is one product whose slug is its name. Every tool that lists products (discovery,
// the slug table, the shardfile build, the catalogue) reads them through here; the folder's manifest.json is then the
// shared base each output's overrides merge into (plain objects merge, everything else replaces).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Deep-merge plain objects (`over` wins); arrays and scalars replace. @param {unknown} base @param {unknown} over @returns {unknown} */
export function mergeManifest(base, over) {
  if (!plain(base) || !plain(over)) return over === undefined ? base : over;
  /** @type {Record<string, unknown>} */
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) out[key] = mergeManifest(base[key], value);
  return out;
}
/** A folder's declared outputs, or null for a one-product folder. @param {string} root @param {string} folder */
export function shardOutputs(root, folder) {
  const file = resolve(root, 'src/shards', folder, 'outputs.json');
  if (!existsSync(file)) return null;
  const rows = JSON.parse(readFileSync(file, 'utf8')).outputs;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`src/shards/${folder}/outputs.json: needs a nonempty outputs list`);
  const seen = new Set();
  return rows.map((row) => {
    if (!plain(row) || typeof row.slug !== 'string' || !SLUG.test(row.slug) || seen.has(row.slug) || row.slug === folder) throw new Error(`src/shards/${folder}/outputs.json: invalid or duplicate output slug ${String(row?.slug)}`);
    if (row.manifest !== undefined && !plain(row.manifest)) throw new Error(`src/shards/${folder}/outputs.json: ${row.slug} manifest overrides must be an object`);
    seen.add(row.slug);
    return { slug: row.slug, folder, row };
  });
}
/** Every product of the shard folders: `{ slug, folder, output }` (output null for a one-product folder), sorted by slug.
 * @param {string} root @param {readonly string[]} folders */
export function shardProducts(root, folders) {
  const products = folders.flatMap((folder) => shardOutputs(root, folder)?.map((output) => ({ slug: output.slug, folder, output: output.row })) ?? [{ slug: folder, folder, output: null }]);
  const slugs = products.map((row) => row.slug);
  if (new Set(slugs).size !== slugs.length) throw new Error('shard outputs: a product slug is declared twice');
  return products.sort((a, b) => a.slug.localeCompare(b.slug));
}
/** An output's authored manifest: the folder base with its overrides, its slug, canonical shardfile path and data map.
 * @param {string} root @param {string} folder @param {{ slug: string, manifest?: object }} output */
export function outputManifest(root, folder, output) {
  const base = JSON.parse(readFileSync(resolve(root, 'src/shards', folder, 'manifest.json'), 'utf8'));
  return mergeManifest(base, { ...output.manifest, slug: output.slug, shardfile: `/shardfiles/${output.slug}/shard.json`, minimap: { image: `/assets/${output.slug}/map/top.webp` } });
}
/** The folders under src/shards with a manifest. @param {string} root */
export function manifestFolders(root) {
  if (!existsSync(resolve(root, 'src/shards'))) return []; // P3: a tree with no shard source has no folders.
  return readdirSync(resolve(root, 'src/shards'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && ['manifest.ts', 'manifest.json'].some((file) => existsSync(resolve(root, 'src/shards', entry.name, file))))
    .map((entry) => entry.name).sort();
}
/** The source folder of a product slug (itself for a one-product folder). @param {string} root @param {string} slug */
export function productFolder(root, slug) {
  return shardProducts(root, manifestFolders(root)).find((row) => row.slug === slug)?.folder ?? slug;
}
/** The built product that stands for a source shard in per-shard measures: a folder that emits several outputs (all from
 * one source, sharing its structure and scripts) is read through its first output; any other folder is its own product.
 * Section inventories union every output (scripts/shard-platform-output.mjs). @param {string} root @param {string} slug */
export function representativeProduct(root, slug) {
  return (/^[a-z0-9_-]+$/u.test(slug) ? shardOutputs(root, slug)?.[0]?.slug : undefined) ?? slug;
}

// SF88g (G538/G539): one source folder may emit several shardfile products. `src/shards/<folder>/outputs.json` lists them:
// `{ "outputs": [{ "slug": "<product slug>", "manifest": { …overrides of the folder's manifest.json }, …the shard's own
// fields }] }`. Without the file a folder is one product whose slug is its name. Every tool that lists products (discovery,
// the slug table, the shardfile build, the catalogue) reads them through here; the folder's manifest.json is then the
// shared base each output's overrides merge into (plain objects merge, everything else replaces).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {string} file @returns {unknown} */
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; } };

/**
 * SA42 (J317, sharddev SA16 `shardSource.ts`): a single-shard repo keeps its shard source at `src/` (its `src/shard.config.ts`, or a
 * hand-written shard file folder `src/shard.json` with no config), a multi-shard repo at `src/shards/<folder>/`. The single source's
 * folder name is a hand-written index's `identity.slug`, else its manifest's slug, else the repo folder's name, as sharddev names it.
 * Null for a repo with no single-shard source. @param {string} root @returns {string | null}
 */
export function singleShardFolder(root) {
  const src = resolve(root, 'src'), config = existsSync(resolve(src, 'shard.config.ts'));
  const handwritten = !config && existsSync(resolve(src, 'shard.json'));
  if (!config && !handwritten) return null;
  if (handwritten) {
    const index = readJson(resolve(src, 'shard.json'));
    if (plain(index) && plain(index.identity) && typeof index.identity.slug === 'string') return index.identity.slug;
  }
  const manifest = readJson(resolve(src, 'manifest.json'));
  return plain(manifest) && typeof manifest.slug === 'string' ? manifest.slug : basename(resolve(root));
}
/** SA42: a shard folder's source directory: `src/` for the single-shard repo's own folder, else `src/shards/<folder>`. @param {string} root @param {string} folder */
export function shardSourceDir(root, folder) {
  return singleShardFolder(root) === folder ? resolve(root, 'src') : resolve(root, 'src/shards', folder);
}
/** SA42: this tree holds shard source in either layout (P3: a tree with none reads pinned products only). @param {string} root */
export function hasShardSource(root) {
  return singleShardFolder(root) !== null || existsSync(resolve(root, 'src/shards'));
}
/** SA42: the source folders holding one of `markers` (a manifest, `shard.config.ts`): `src/shards/*` and a single-shard repo's own, sorted.
 * @param {string} root @param {readonly string[]} markers */
export function shardSourceFolders(root, markers) {
  const single = singleShardFolder(root), shards = resolve(root, 'src/shards');
  const folders = existsSync(shards) ? readdirSync(shards, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && markers.some((file) => existsSync(resolve(shards, entry.name, file)))).map((entry) => entry.name) : [];
  if (single !== null && !folders.includes(single) && markers.some((file) => existsSync(resolve(root, 'src', file)))) folders.push(single);
  return folders.sort();
}
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
  const file = resolve(shardSourceDir(root, folder), 'outputs.json'), named = relative(resolve(root), file);
  if (!existsSync(file)) return null;
  const rows = JSON.parse(readFileSync(file, 'utf8')).outputs;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${named}: needs a nonempty outputs list`);
  const seen = new Set();
  return rows.map((row) => {
    if (!plain(row) || typeof row.slug !== 'string' || !SLUG.test(row.slug) || seen.has(row.slug) || row.slug === folder) throw new Error(`${named}: invalid or duplicate output slug ${String(row?.slug)}`);
    if (row.manifest !== undefined && !plain(row.manifest)) throw new Error(`${named}: ${row.slug} manifest overrides must be an object`);
    seen.add(row.slug);
    return { slug: row.slug, folder, row };
  });
}
/** Every product of the shard folders: `{ slug, folder, output }` (output null for a one-product folder), sorted by slug.
 * @param {string} root @param {readonly string[]} folders */
export function builtShardFolders(root, folders) {
  const products = folders.flatMap((folder) => shardOutputs(root, folder)?.map((output) => ({ slug: output.slug, folder, output: output.row })) ?? [{ slug: folder, folder, output: null }]);
  const slugs = products.map((row) => row.slug);
  if (new Set(slugs).size !== slugs.length) throw new Error('shard outputs: a product slug is declared twice');
  return products.sort((a, b) => a.slug.localeCompare(b.slug));
}
/** An output's authored manifest: the folder base with its overrides, its slug, canonical shardfile path and data map.
 * @param {string} root @param {string} folder @param {{ slug: string, manifest?: object }} output */
export function outputManifest(root, folder, output) {
  const base = JSON.parse(readFileSync(resolve(shardSourceDir(root, folder), 'manifest.json'), 'utf8'));
  return mergeManifest(base, { ...output.manifest, slug: output.slug, shardfile: `/shardfiles/${output.slug}/shard.json`, minimap: { image: `/assets/${output.slug}/map/top.webp` } });
}
/** The shard folders with a manifest: under src/shards, or a single-shard repo's src/ (SA42). P3: a tree with no shard source has none. @param {string} root */
export function manifestFolders(root) {
  return shardSourceFolders(root, ['manifest.ts', 'manifest.json']);
}
/** The source folder of a product slug (itself for a one-product folder). @param {string} root @param {string} slug */
export function builtFolder(root, slug) {
  return builtShardFolders(root, manifestFolders(root)).find((row) => row.slug === slug)?.folder ?? slug;
}
/** The built product that stands for a source shard in per-shard measures: a folder that emits several outputs (all from
 * one source, sharing its structure and scripts) is read through its first output; any other folder is its own product.
 * Section inventories union every output (scripts/output-reader.mjs). @param {string} root @param {string} slug */
export function representativeFolder(root, slug) {
  return (/^[a-z0-9_-]+$/u.test(slug) ? shardOutputs(root, slug)?.[0]?.slug : undefined) ?? slug;
}

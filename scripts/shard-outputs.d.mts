/** One declared output row of `src/shards/<folder>/outputs.json`: its product slug, manifest overrides and the shard's own fields. */
export interface ShardOutputRow { readonly slug: string; readonly manifest?: Readonly<Record<string, unknown>>; readonly [field: string]: unknown }
/** A product of the shard folders: an output of a folder, or the folder itself (`output` null). */
export interface ShardProduct { readonly slug: string; readonly folder: string; readonly output: ShardOutputRow | null }
export function mergeManifest(base: unknown, over: unknown): unknown;
/** SA42: a single-shard repo's folder name (its source at `src/`), or null. */
export function singleShardFolder(root: string): string | null;
/** SA42: a shard folder's source directory, `src/` or `src/shards/<folder>`. */
export function shardSourceDir(root: string, folder: string): string;
/** SA42: the tree holds shard source in either layout. */
export function hasShardSource(root: string): boolean;
/** SA42: the source folders holding one of `markers`, in either layout, sorted. */
export function shardSourceFolders(root: string, markers: readonly string[]): string[];
export function shardOutputs(root: string, folder: string): { slug: string; folder: string; row: ShardOutputRow }[] | null;
export function shardProducts(root: string, folders: readonly string[]): ShardProduct[];
export function outputManifest(root: string, folder: string, output: ShardOutputRow): Record<string, unknown>;
export function manifestFolders(root: string): string[];
export function productFolder(root: string, slug: string): string;
/** The built product that stands for a source shard in per-shard measures (its first output, else itself). */
export function representativeProduct(root: string, slug: string): string;
